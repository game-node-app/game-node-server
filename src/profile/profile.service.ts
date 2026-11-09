import {
    forwardRef,
    HttpException,
    HttpStatus,
    Inject,
    Injectable,
    Logger,
    Optional,
} from "@nestjs/common";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { InjectRepository } from "@nestjs/typeorm";
import { Profile } from "./entities/profile.entity";
import { Repository } from "typeorm";
import { ProfileAvatar } from "./entities/profile-avatar.entity";
import { generateUsername } from "unique-username-generator";
import {
    PROFILE_IMAGE_ALLOWED_IDENTIFIERS,
    UpdateProfileImageDto,
} from "./dto/update-profile-image.dto";
import { ProfileBanner } from "./entities/profile-banner.entity";
import { ProfileVideo } from "./entities/profile-video.entity";
import { FindAllProfileResponseItemDto } from "./dto/find-all-profile.dto";
import { AuthService } from "../auth/auth.service";
import { UploadService } from "../upload/upload.service";
import { NotificationsLifecycleService } from "../notifications/notifications-lifecycle.service";
import { cleanupStatisticsProfile } from "../statistics/statistics-target.repository";

@Injectable()
export class ProfileService {
    private logger = new Logger(ProfileService.name);
    constructor(
        @InjectRepository(Profile)
        private profileRepository: Repository<Profile>,
        @InjectRepository(ProfileVideo)
        private profileVideoRepository: Repository<ProfileVideo>,
        // auth.service imports user-init.service, which imports this file.
        @Inject(forwardRef(() => AuthService))
        private readonly authService: AuthService,
        private readonly uploadService: UploadService,
        @Optional()
        private readonly notificationsLifecycleService?: NotificationsLifecycleService,
    ) {}

    /**
     * Called at initial user registration
     * @param userId
     */
    async create(userId: string) {
        let usernameInUse = true;
        let placeholderUsername = "";
        while (usernameInUse) {
            placeholderUsername = generateUsername("-", 4, 20);
            usernameInUse = await this.existsByUserName(placeholderUsername);
        }

        const profile = this.profileRepository.create({
            userId: userId,
            username: placeholderUsername,
        });
        await this.profileRepository.insert(profile);
    }

    private async storeImage(
        userId: string,
        file: Express.Multer.File,
    ): Promise<{ fileName: string; fileExt: string }> {
        try {
            const { fileName, fileExt } = await this.uploadService.save(
                userId,
                file,
            );
            return { fileName, fileExt };
        } catch (e) {
            this.logger.error(e);
            throw new HttpException("Error saving profile image.", 500);
        }
    }

    public async updateProfileImage(
        userId: string,
        dto: UpdateProfileImageDto,
        file: Express.Multer.File,
    ) {
        await this.findOneByIdOrFail(userId);

        if (!file) return;
        if (!PROFILE_IMAGE_ALLOWED_IDENTIFIERS.includes(dto.type)) {
            throw new HttpException(
                "Invalid image type.",
                HttpStatus.BAD_REQUEST,
                {
                    cause: `Allowed values: ${PROFILE_IMAGE_ALLOWED_IDENTIFIERS}`,
                },
            );
        }

        const stored = await this.storeImage(userId, file);

        let replaced: { image: string | null; video: string | null };
        try {
            replaced = await this.profileRepository.manager.transaction(
                async (manager) => {
                    // Lock the slot row first: this serializes with the worker's
                    // publish transaction, which updates it before swapping images.
                    const videos = manager.getRepository(ProfileVideo);
                    const video = await videos.findOne({
                        where: { profileUserId: userId, type: dto.type },
                        lock: { mode: "pessimistic_write" },
                    });

                    const profiles = manager.getRepository(Profile);
                    const profile = await profiles.findOne({
                        where: { userId },
                        relations: { avatar: true, banner: true },
                    });
                    if (!profile) {
                        throw new HttpException(
                            "Profile not found",
                            HttpStatus.NOT_FOUND,
                        );
                    }

                    const previous =
                        dto.type === "avatar" ? profile.avatar : profile.banner;
                    const imageDetails = {
                        encoding: file.encoding,
                        filename: stored.fileName,
                        mimetype: file.mimetype,
                        extension: stored.fileExt,
                        size: file.size,
                    };
                    if (dto.type === "avatar") {
                        const avatars = manager.getRepository(ProfileAvatar);
                        profile.avatar = await avatars.save(
                            avatars.create(imageDetails),
                        );
                    } else {
                        const banners = manager.getRepository(ProfileBanner);
                        profile.banner = await banners.save(
                            banners.create(imageDetails),
                        );
                    }
                    await profiles.save(profile);

                    if (previous) {
                        if (dto.type === "avatar") {
                            await manager
                                .getRepository(ProfileAvatar)
                                .delete(previous.id);
                        } else {
                            await manager
                                .getRepository(ProfileBanner)
                                .delete(previous.id);
                        }
                    }
                    if (video) await videos.delete(video.id);

                    return {
                        image: previous
                            ? `${previous.filename}.${previous.extension}`
                            : null,
                        video: video?.filename ? `${video.filename}.mp4` : null,
                    };
                },
            );
        } catch (error) {
            await this.deleteObject(`${stored.fileName}.${stored.fileExt}`);
            throw error;
        }

        await this.deleteObject(replaced.image);
        await this.deleteObject(replaced.video);
    }

    async findAll(): Promise<FindAllProfileResponseItemDto[]> {
        const profiles = await this.profileRepository.find();
        const lockouts = await this.authService.getLockoutStates(
            profiles.map((profile) => profile.userId),
        );

        return profiles.map((profile) => ({
            profile,
            isSuspended: lockouts.get(profile.userId)?.isSuspended ?? false,
            isBanned: lockouts.get(profile.userId)?.isBanned ?? false,
        }));
    }

    async findOneById(userId: string): Promise<Profile | null> {
        return await this.profileRepository.findOne({
            where: {
                userId,
            },
            relations: {
                avatar: true,
                banner: true,
            },
        });
    }

    async findOneByIdOrFail(userId: string) {
        const profile = await this.findOneById(userId);
        if (!profile) {
            throw new HttpException("Profile not found", HttpStatus.NOT_FOUND);
        }
        return profile;
    }

    private async existsByUserName(username: string) {
        return await this.profileRepository.exists({
            where: {
                username,
            },
        });
    }

    async update(userId: string, updateProfileDto: UpdateProfileDto) {
        const profile = await this.findOneById(userId);
        if (!profile) {
            throw new HttpException(
                "Profile was not found",
                HttpStatus.NOT_FOUND,
            );
        }

        if (updateProfileDto.username) {
            const usernameInUse = await this.existsByUserName(
                updateProfileDto.username,
            );
            if (usernameInUse) {
                throw new HttpException(
                    "A profile with the same username already exists",
                    HttpStatus.BAD_REQUEST,
                );
            }
            if (profile.usernameLastUpdatedAt) {
                const thirtyDaysAgo = new Date();
                thirtyDaysAgo.setDate(-30);
                if (
                    profile.usernameLastUpdatedAt.getTime() >
                    thirtyDaysAgo.getTime()
                ) {
                    throw new HttpException(
                        "Username updated in the last 30 days. Please try again later.",
                        HttpStatus.BAD_REQUEST,
                    );
                }
            }
            profile.username = updateProfileDto.username;
            profile.usernameLastUpdatedAt = new Date();
        }
        profile.bio = updateProfileDto.bio ?? profile.bio;

        await this.profileRepository.save(profile);
    }

    async deleteByUserId(userId: string) {
        // Read the media before the transaction: the FK cascades remove these rows.
        const profile = await this.profileRepository.findOne({
            where: { userId },
            relations: { avatar: true, banner: true },
        });
        const videos = await this.profileVideoRepository.find({
            where: { profileUserId: userId },
        });

        let deleted = false;
        await this.profileRepository.manager.transaction(async (manager) => {
            const repository = manager.getRepository(Profile);
            const lockedProfile = await repository.findOne({
                where: { userId },
                lock: { mode: "pessimistic_write" },
            });
            if (!lockedProfile) return;
            deleted = true;
            await this.notificationsLifecycleService?.invalidateProfile(
                userId,
                manager,
            );
            await cleanupStatisticsProfile(manager, userId);
            await repository.delete({ userId });
        });

        if (!deleted || !profile) return;
        await this.deleteObject(
            profile.avatar
                ? `${profile.avatar.filename}.${profile.avatar.extension}`
                : null,
        );
        await this.deleteObject(
            profile.banner
                ? `${profile.banner.filename}.${profile.banner.extension}`
                : null,
        );
        for (const video of videos) {
            await this.deleteObject(
                video.filename ? `${video.filename}.mp4` : null,
            );
        }
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
