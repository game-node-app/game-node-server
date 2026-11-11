import { InjectRepository } from "@nestjs/typeorm";
import {
    BadRequestException,
    ConflictException,
    Injectable,
    InternalServerErrorException,
    Logger,
} from "@nestjs/common";
import { Repository } from "typeorm";
import { randomUUID } from "node:crypto";
import {
    chmod,
    chown,
    copyFile,
    mkdir,
    rename,
    rm,
    stat,
    unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { BillingService } from "../../billing/billing.service";
import { UploadService } from "../../upload/upload.service";
import { Profile } from "../entities/profile.entity";
import { ProfileAvatar } from "../entities/profile-avatar.entity";
import { ProfileBanner } from "../entities/profile-banner.entity";
import { ProfileVideo } from "../entities/profile-video.entity";
import { ProfileImageIdentifier } from "../dto/update-profile-image.dto";
import {
    ConvertedVideo,
    convert,
    prepareJobDirectory,
    probe,
    ProfileVideoError,
} from "./profile-video-media";
import { MEDIA_NOBODY_GID, MEDIA_NOBODY_UID } from "./media-process";
import {
    ProfileVideoJobData,
    ProfileVideoUpload,
    PROFILE_VIDEO_STALE_MS,
    PROFILE_VIDEO_TEMP_ROOT,
} from "./profile-video.constants";
import { ProfileVideoQueueService } from "./profile-video-queue.service";

/** Media tools drop to 65534 when the server is root, so the temp root must stay traversable and the source readable. */
export async function ensureProfileVideoTempRoot(): Promise<void> {
    await mkdir(PROFILE_VIDEO_TEMP_ROOT, { recursive: true, mode: 0o755 });
    await chmod(PROFILE_VIDEO_TEMP_ROOT, 0o755);
}

async function moveSource(from: string, to: string): Promise<void> {
    try {
        await rename(from, to);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EXDEV") {
            throw error;
        }
        await copyFile(from, to);
        await unlink(from);
    }
    await chmod(to, 0o644);
    if (typeof process.getuid === "function" && process.getuid() === 0) {
        await chown(to, MEDIA_NOBODY_UID, MEDIA_NOBODY_GID);
    }
}

@Injectable()
export class ProfileVideoService {
    private readonly logger = new Logger(ProfileVideoService.name);

    constructor(
        @InjectRepository(ProfileVideo)
        private readonly repository: Repository<ProfileVideo>,
        private readonly queue: ProfileVideoQueueService,
        private readonly billingService: BillingService,
        private readonly uploadService: UploadService,
    ) {}

    async upload(
        userId: string,
        upload: ProfileVideoUpload,
        file: Express.Multer.File,
    ): Promise<{ status: "processing" }> {
        await ensureProfileVideoTempRoot();
        await chmod(file.path, 0o644);

        try {
            await probe(file.path);
        } catch (error) {
            if (
                error instanceof ProfileVideoError &&
                error.code === "rejected_source"
            ) {
                throw new BadRequestException("Invalid video file.");
            }
            throw error;
        }

        const attemptId = randomUUID();
        await this.claim(userId, upload.type, attemptId);

        try {
            await this.queue.add({
                userId,
                type: upload.type,
                sourcePath: file.path,
                crop: upload.crop,
                attemptId,
            });
        } catch (error) {
            this.logger.error(error);
            // The entity has no queue error code; the owner can simply retry.
            await this.failAttempt(
                { userId, type: upload.type, attemptId },
                "conversion_failed",
            );
            throw new InternalServerErrorException(
                "Could not queue video processing.",
            );
        }

        return { status: "processing" };
    }

    /** 5.1 composes the video fields from this; the entity is the only source of published media. */
    async findByUserId(userId: string): Promise<ProfileVideo[]> {
        return this.repository.find({ where: { profileUserId: userId } });
    }

    /** 5.1 hides videos on entitlement lookup failure instead of failing the profile read. */
    async isSupporter(userId: string): Promise<boolean> {
        try {
            return await this.billingService.isSupporter(userId);
        } catch {
            return false;
        }
    }

    /**
     * Profile read fields (design 1). The caller resolves entitlement once;
     * a public read of a non-supporter skips the query entirely.
     */
    async findForProfileRead(
        userId: string,
        includeUploads: boolean,
        isSupporter: boolean,
    ) {
        if (!isSupporter && !includeUploads) {
            return { avatarVideo: null, bannerVideo: null };
        }

        const rows = await this.findByUserId(userId);
        const slots = new Map(rows.map((row) => [row.type, row]));
        const avatar = slots.get("avatar");
        const banner = slots.get("banner");

        const published = (row: ProfileVideo | undefined) =>
            row?.filename && isSupporter
                ? {
                      filename: row.filename,
                      extension: "mp4",
                      mimetype: "video/mp4",
                      size: row.size!,
                      durationMs: row.durationMs!,
                      width: row.width!,
                      height: row.height!,
                  }
                : null;

        const upload = (row: ProfileVideo | undefined) => {
            if (!row?.status) return null;
            const stale =
                row.status === "processing" &&
                row.processingStartedAt !== null &&
                Date.now() - row.processingStartedAt.getTime() >
                    PROFILE_VIDEO_STALE_MS;
            return stale
                ? { status: "failed" as const, errorCode: "timeout" as const }
                : { status: row.status, errorCode: row.errorCode };
        };

        return {
            avatarVideo: published(avatar),
            bannerVideo: published(banner),
            ...(includeUploads
                ? {
                      videoUploads: {
                          avatar: upload(avatar),
                          banner: upload(banner),
                      },
                  }
                : {}),
        };
    }

    async process(data: ProfileVideoJobData): Promise<void> {
        const jobDirectory = join(
            PROFILE_VIDEO_TEMP_ROOT,
            `job-${randomUUID()}`,
        );

        try {
            await ensureProfileVideoTempRoot();
            const current = await this.repository.findOne({
                where: {
                    profileUserId: data.userId,
                    type: data.type,
                },
            });
            if (
                !current ||
                current.status !== "processing" ||
                current.attemptId !== data.attemptId
            ) {
                return;
            }

            try {
                await stat(data.sourcePath);
            } catch {
                await this.failAttempt(data, "source_missing");
                return;
            }

            await prepareJobDirectory(jobDirectory);
            const sourcePath = join(jobDirectory, "source");
            await moveSource(data.sourcePath, sourcePath);

            let converted: ConvertedVideo;
            try {
                converted = await convert(
                    data.type,
                    sourcePath,
                    jobDirectory,
                    data.crop,
                );
            } catch (error) {
                await this.failAttempt(
                    data,
                    error instanceof ProfileVideoError &&
                        error.code === "output_too_large"
                        ? "output_too_large"
                        : "conversion_failed",
                );
                return;
            }

            let posterSize: number;
            let video:
                | Awaited<ReturnType<UploadService["saveStoredFile"]>>
                | undefined;
            let poster: Awaited<ReturnType<UploadService["saveStoredFile"]>>;
            try {
                posterSize = (await stat(converted.posterPath)).size;
                video = await this.uploadService.saveStoredFile(
                    data.userId,
                    converted.path,
                    "video/mp4",
                );
                poster = await this.uploadService.saveStoredFile(
                    data.userId,
                    converted.posterPath,
                    "image/jpeg",
                );
            } catch (error) {
                this.logger.error(error);
                if (video) {
                    await this.deleteObject(
                        `${video.fileName}.${video.fileExt}`,
                    );
                }
                await this.failAttempt(data, "upload_failed");
                return;
            }

            let replaced: {
                video: string | null;
                image: string | null;
            } | null;
            try {
                replaced = await this.publish(
                    data,
                    converted,
                    video,
                    poster,
                    posterSize,
                );
            } catch (error) {
                this.logger.error(error);
                await this.deleteObject(`${video.fileName}.${video.fileExt}`);
                await this.deleteObject(`${poster.fileName}.${poster.fileExt}`);
                await this.failAttempt(data, "conversion_failed");
                return;
            }
            if (!replaced) {
                await this.deleteObject(`${video.fileName}.${video.fileExt}`);
                await this.deleteObject(`${poster.fileName}.${poster.fileExt}`);
                return;
            }

            await this.deleteObject(replaced.video);
            await this.deleteObject(replaced.image);
        } catch (error) {
            this.logger.error(error);
            await this.failAttempt(data, "conversion_failed");
        } finally {
            await rm(data.sourcePath, { force: true }).catch(() => undefined);
            await rm(jobDirectory, { recursive: true, force: true }).catch(
                () => undefined,
            );
        }
    }

    private async claim(
        userId: string,
        type: ProfileImageIdentifier,
        attemptId: string,
    ): Promise<void> {
        // INSERT IGNORE keeps parallel first uploads from racing on the unique key.
        await this.repository
            .createQueryBuilder()
            .insert()
            .into(ProfileVideo)
            .values({ profileUserId: userId, type })
            .orIgnore()
            .execute();

        const result = await this.repository
            .createQueryBuilder()
            .update(ProfileVideo)
            .set({
                status: "processing",
                attemptId,
                errorCode: null,
                processingStartedAt: () => "CURRENT_TIMESTAMP(3)",
            })
            .where("profileUserId = :userId AND type = :type", { userId, type })
            .andWhere(
                "(status IS NULL OR status <> 'processing' OR processingStartedAt < :stale)",
                { stale: new Date(Date.now() - PROFILE_VIDEO_STALE_MS) },
            )
            .execute();

        if (!result.affected) {
            throw new ConflictException(
                "A video for this slot is already processing.",
            );
        }
    }

    private async failAttempt(
        data: Pick<ProfileVideoJobData, "userId" | "type" | "attemptId">,
        errorCode:
            | "conversion_failed"
            | "output_too_large"
            | "upload_failed"
            | "source_missing",
    ): Promise<void> {
        try {
            await this.repository
                .createQueryBuilder()
                .update(ProfileVideo)
                .set({ status: "failed", errorCode })
                .where(
                    "profileUserId = :userId AND type = :type AND attemptId = :attemptId",
                    {
                        userId: data.userId,
                        type: data.type,
                        attemptId: data.attemptId,
                    },
                )
                .execute();
        } catch (error) {
            this.logger.error(error);
        }
    }

    private async publish(
        data: ProfileVideoJobData,
        converted: ConvertedVideo,
        video: Awaited<ReturnType<UploadService["saveStoredFile"]>>,
        poster: Awaited<ReturnType<UploadService["saveStoredFile"]>>,
        posterSize: number,
    ): Promise<{ video: string | null; image: string | null } | null> {
        return this.repository.manager.transaction(async (manager) => {
            const videos = manager.getRepository(ProfileVideo);
            const current = await videos.findOne({
                where: {
                    profileUserId: data.userId,
                    type: data.type,
                },
            });
            if (
                !current ||
                current.status !== "processing" ||
                current.attemptId !== data.attemptId
            ) {
                return null;
            }

            const profiles = manager.getRepository(Profile);
            const profile = await profiles.findOne({
                where: { userId: data.userId },
                relations: { avatar: true, banner: true },
            });
            if (!profile) return null;

            const oldImage =
                data.type === "avatar" ? profile.avatar : profile.banner;
            const result = await videos.update(
                {
                    profileUserId: data.userId,
                    type: data.type,
                    attemptId: data.attemptId,
                },
                {
                    filename: video.fileName,
                    size: converted.size,
                    durationMs: converted.durationMs,
                    width: converted.width,
                    height: converted.height,
                    status: "ready",
                    errorCode: null,
                },
            );
            if (result.affected !== 1) return null;

            const imageDetails = {
                encoding: "7bit",
                filename: poster.fileName,
                mimetype: "image/jpeg",
                extension: poster.fileExt,
                size: posterSize,
            };
            if (data.type === "avatar") {
                profile.avatar = await manager
                    .getRepository(ProfileAvatar)
                    .save(
                        manager
                            .getRepository(ProfileAvatar)
                            .create(imageDetails),
                    );
            } else {
                profile.banner = await manager
                    .getRepository(ProfileBanner)
                    .save(
                        manager
                            .getRepository(ProfileBanner)
                            .create(imageDetails),
                    );
            }
            await profiles.save(profile);

            if (oldImage) {
                if (data.type === "avatar") {
                    await manager
                        .getRepository(ProfileAvatar)
                        .delete(oldImage.id);
                } else {
                    await manager
                        .getRepository(ProfileBanner)
                        .delete(oldImage.id);
                }
            }

            return {
                video: current.filename ? `${current.filename}.mp4` : null,
                image: oldImage
                    ? `${oldImage.filename}.${oldImage.extension}`
                    : null,
            };
        });
    }

    private async deleteObject(key: string | null): Promise<void> {
        if (!key) return;
        try {
            await this.uploadService.delete(key);
        } catch (error) {
            this.logger.warn(`Could not delete profile media ${key}: ${error}`);
        }
    }
}
