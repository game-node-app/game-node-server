import { PROFILE_VIDEO_TEST_TEMP_ROOT } from "../../../test/mocks/profile-video-temp-root";

jest.mock("./profile-video-media", () => {
    const actual = jest.requireActual("./profile-video-media");
    const fs = jest.requireActual("node:fs/promises");
    return {
        ...actual,
        probe: jest.fn(),
        convert: jest.fn(),
        prepareJobDirectory: jest.fn(async (directory: string) => {
            await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        }),
    };
});

import { BadRequestException, ConflictException } from "@nestjs/common";
import { access, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, basename } from "node:path";
import { Profile } from "../entities/profile.entity";
import { ProfileAvatar } from "../entities/profile-avatar.entity";
import { ProfileBanner } from "../entities/profile-banner.entity";
import { ProfileVideo } from "../entities/profile-video.entity";
import { ProfileImageIdentifier } from "../dto/update-profile-image.dto";
import { MediaProcessError } from "./media-process";
import { PROFILE_VIDEO_STALE_MS } from "./profile-video.constants";
import { convert, probe, ProfileVideoError } from "./profile-video-media";
import { ProfileVideoService } from "./profile-video.service";

const probeMock = probe as jest.Mock;
const convertMock = convert as jest.Mock;

function repositoryFixture() {
    const queryBuilder: Record<string, jest.Mock> = {
        insert: jest.fn(() => queryBuilder),
        into: jest.fn(() => queryBuilder),
        values: jest.fn(() => queryBuilder),
        orIgnore: jest.fn(() => queryBuilder),
        update: jest.fn(() => queryBuilder),
        set: jest.fn(() => queryBuilder),
        where: jest.fn(() => queryBuilder),
        andWhere: jest.fn(() => queryBuilder),
        execute: jest.fn(async () => ({ affected: 1 })),
    };
    const repository = {
        createQueryBuilder: jest.fn(() => queryBuilder),
        find: jest.fn(async () => [] as ProfileVideo[]),
        findOne: jest.fn(),
        manager: { transaction: jest.fn() },
    };
    return { queryBuilder, repository };
}

function managerFixture() {
    const videos = {
        findOne: jest.fn(),
        update: jest.fn(async () => ({ affected: 1 })),
    };
    const profiles = {
        findOne: jest.fn(),
        save: jest.fn(async (profile: Profile) => profile),
    };
    const images = () => ({
        create: jest.fn((details) => ({ id: 10, ...details })),
        save: jest.fn(async (image) => image),
        delete: jest.fn(),
    });
    const avatars = images();
    const banners = images();
    const repositories = new Map<unknown, unknown>([
        [ProfileVideo, videos],
        [Profile, profiles],
        [ProfileAvatar, avatars],
        [ProfileBanner, banners],
    ]);
    const manager = {
        getRepository: jest.fn((entity: unknown) => repositories.get(entity)),
    };
    return { manager, videos, profiles, avatars, banners };
}

async function exists(path: string): Promise<boolean> {
    return access(path).then(
        () => true,
        () => false,
    );
}

describe("ProfileVideoService", () => {
    let repository: ReturnType<typeof repositoryFixture>["repository"];
    let queryBuilder: ReturnType<typeof repositoryFixture>["queryBuilder"];
    let queue: { add: jest.Mock };
    let billing: { isSupporter: jest.Mock };
    let upload: {
        saveStoredFile: jest.Mock;
        delete: jest.Mock;
    };
    let service: ProfileVideoService;

    beforeEach(async () => {
        jest.clearAllMocks();
        ({ repository, queryBuilder } = repositoryFixture());
        queue = { add: jest.fn(async () => ({})) };
        billing = { isSupporter: jest.fn(async () => true) };
        upload = {
            saveStoredFile: jest.fn(),
            delete: jest.fn(async () => undefined),
        };
        service = new ProfileVideoService(
            repository as never,
            queue as never,
            billing as never,
            upload as never,
        );
        probeMock.mockResolvedValue({});
        await mkdir(PROFILE_VIDEO_TEST_TEMP_ROOT, { recursive: true });
    });

    afterEach(async () => {
        await rm(PROFILE_VIDEO_TEST_TEMP_ROOT, {
            recursive: true,
            force: true,
        });
    });

    async function sourceFile() {
        const path = join(
            PROFILE_VIDEO_TEST_TEMP_ROOT,
            `source-${randomUUID()}`,
        );
        await writeFile(path, "source-bytes", { mode: 0o600 });
        return path;
    }

    describe("upload", () => {
        it("probes, claims the slot and enqueues with the attempt id", async () => {
            const file = {
                path: await sourceFile(),
            } as Express.Multer.File;

            await expect(
                service.upload("user-1", { type: "avatar" }, file),
            ).resolves.toEqual({ status: "processing" });

            expect(((await stat(file.path)).mode & 0o777).toString(8)).toBe(
                "644",
            );
            expect(probeMock).toHaveBeenCalledWith(file.path);
            expect(queryBuilder.insert).toHaveBeenCalled();
            expect(queryBuilder.orIgnore).toHaveBeenCalled();
            expect(queryBuilder.set).toHaveBeenCalledWith({
                status: "processing",
                attemptId: expect.any(String),
                errorCode: null,
                processingStartedAt: expect.any(Function),
            });
            expect(queue.add).toHaveBeenCalledWith({
                userId: "user-1",
                type: "avatar",
                sourcePath: file.path,
                crop: undefined,
                attemptId: expect.any(String),
            });
        });

        it("rejects an invalid source with 400 and does not claim", async () => {
            probeMock.mockRejectedValue(
                new ProfileVideoError("rejected_source"),
            );

            await expect(
                service.upload("user-1", { type: "avatar" }, {
                    path: await sourceFile(),
                } as Express.Multer.File),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(queryBuilder.update).not.toHaveBeenCalled();
            expect(queue.add).not.toHaveBeenCalled();
        });

        it("rejects a second running attempt with 409", async () => {
            queryBuilder.execute
                .mockResolvedValueOnce({})
                .mockResolvedValueOnce({ affected: 0 });

            await expect(
                service.upload("user-1", { type: "avatar" }, {
                    path: await sourceFile(),
                } as Express.Multer.File),
            ).rejects.toBeInstanceOf(ConflictException);
            expect(queue.add).not.toHaveBeenCalled();
        });

        it("fails the attempt and returns 500 when enqueueing fails", async () => {
            queue.add.mockRejectedValue(new Error("redis down"));

            await expect(
                service.upload("user-1", { type: "avatar" }, {
                    path: await sourceFile(),
                } as Express.Multer.File),
            ).rejects.toMatchObject({ status: 500 });
            expect(queryBuilder.set).toHaveBeenLastCalledWith({
                status: "failed",
                errorCode: "conversion_failed",
            });
            expect(queryBuilder.where).toHaveBeenLastCalledWith(
                expect.stringContaining("attemptId = :attemptId"),
                expect.objectContaining({ attemptId: expect.any(String) }),
            );
        });
    });

    describe("process", () => {
        let lastJobDirectory: string | undefined;
        const job: {
            userId: string;
            type: ProfileImageIdentifier;
            sourcePath: string;
            attemptId: string;
        } = {
            userId: "user-1",
            type: "banner",
            sourcePath: "",
            attemptId: "attempt-1",
        };

        beforeEach(() => {
            lastJobDirectory = undefined;
        });

        function row(overrides: Partial<ProfileVideo> = {}): ProfileVideo {
            return {
                profileUserId: "user-1",
                type: "banner",
                filename: "old-video",
                size: 100,
                durationMs: 5000,
                width: 1280,
                height: 548,
                status: "processing",
                attemptId: "attempt-1",
                errorCode: null,
                processingStartedAt: new Date(),
                ...overrides,
            } as ProfileVideo;
        }

        async function prepareJob() {
            job.sourcePath = await sourceFile();
            repository.findOne.mockResolvedValue(row());
            convertMock.mockImplementation(
                async (
                    _slot: string,
                    _source: string,
                    jobDirectory: string,
                ) => {
                    lastJobDirectory = jobDirectory;
                    const videoPath = join(jobDirectory, "video.mp4");
                    const posterPath = join(jobDirectory, "poster.jpg");
                    await writeFile(videoPath, "converted-video");
                    await writeFile(posterPath, "poster");
                    return {
                        path: videoPath,
                        posterPath,
                        size: 15,
                        durationMs: 8000,
                        width: 1280,
                        height: 548,
                    };
                },
            );
            upload.saveStoredFile
                .mockResolvedValueOnce({
                    fileName: "new-video",
                    fileExt: "mp4",
                    fileNameWithExtension: "new-video.mp4",
                })
                .mockResolvedValueOnce({
                    fileName: "new-poster",
                    fileExt: "jpeg",
                    fileNameWithExtension: "new-poster.jpeg",
                });
        }

        it("converts, uploads and publishes atomically, then deletes replaced objects", async () => {
            await prepareJob();
            const events: string[] = [];
            const fixtures = managerFixture();
            fixtures.videos.findOne.mockResolvedValue(row());
            fixtures.profiles.findOne.mockResolvedValue({
                userId: "user-1",
                avatar: null,
                banner: {
                    id: 7,
                    filename: "old-poster",
                    extension: "jpeg",
                },
            });
            repository.manager.transaction.mockImplementation(
                async (callback: (manager: unknown) => Promise<unknown>) => {
                    const result = await callback(fixtures.manager);
                    events.push("commit");
                    return result;
                },
            );
            upload.delete.mockImplementation(async () => {
                events.push("delete");
            });

            await service.process(job);

            expect(convertMock).toHaveBeenCalledWith(
                "banner",
                expect.stringContaining("source"),
                expect.stringContaining(PROFILE_VIDEO_TEST_TEMP_ROOT),
                undefined,
            );
            expect(fixtures.videos.update).toHaveBeenCalledWith(
                {
                    profileUserId: "user-1",
                    type: "banner",
                    attemptId: "attempt-1",
                },
                {
                    filename: "new-video",
                    size: 15,
                    durationMs: 8000,
                    width: 1280,
                    height: 548,
                    status: "ready",
                    errorCode: null,
                },
            );
            expect(fixtures.banners.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    filename: "new-poster",
                    extension: "jpeg",
                    mimetype: "image/jpeg",
                    size: 6,
                    encoding: "7bit",
                }),
            );
            expect(fixtures.profiles.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    banner: expect.objectContaining({ id: 10 }),
                }),
            );
            expect(fixtures.banners.delete).toHaveBeenCalledWith(7);
            expect(upload.delete.mock.calls).toEqual([
                ["old-video.mp4"],
                ["old-poster.jpeg"],
            ]);
            expect(events).toEqual(["commit", "delete", "delete"]);
            expect(await exists(job.sourcePath)).toBe(false);
            expect(await exists(lastJobDirectory!)).toBe(false);
        });

        it("uploads only the converted video and poster, never the queued source", async () => {
            await prepareJob();
            repository.manager.transaction.mockRejectedValue(
                new Error("stop after upload"),
            );

            await service.process(job);

            expect(upload.saveStoredFile.mock.calls).toEqual([
                ["user-1", join(lastJobDirectory!, "video.mp4"), "video/mp4"],
                ["user-1", join(lastJobDirectory!, "poster.jpg"), "image/jpeg"],
            ]);
            expect(
                JSON.stringify(upload.saveStoredFile.mock.calls),
            ).not.toContain(basename(job.sourcePath));
        });

        it("publishes an avatar and removes the old avatar row", async () => {
            await prepareJob();
            job.type = "avatar";
            repository.findOne.mockResolvedValue(
                row({ type: "avatar", filename: "old-avatar-video" }),
            );
            const fixtures = managerFixture();
            fixtures.videos.findOne.mockResolvedValue(
                row({ type: "avatar", filename: "old-avatar-video" }),
            );
            fixtures.profiles.findOne.mockResolvedValue({
                userId: "user-1",
                avatar: { id: 8, filename: "old-avatar", extension: "png" },
                banner: null,
            });
            repository.manager.transaction.mockImplementation(
                async (callback: (manager: unknown) => Promise<unknown>) =>
                    callback(fixtures.manager),
            );

            await service.process(job);

            expect(fixtures.avatars.delete).toHaveBeenCalledWith(8);
            expect(fixtures.profiles.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    avatar: expect.objectContaining({ id: 10 }),
                }),
            );
            expect(upload.delete.mock.calls).toEqual([
                ["old-avatar-video.mp4"],
                ["old-avatar.png"],
            ]);
        });

        it("fails with conversion_failed and keeps the published media", async () => {
            await prepareJob();
            convertMock.mockRejectedValue(
                new ProfileVideoError("conversion_failed"),
            );

            await service.process(job);

            expect(queryBuilder.set).toHaveBeenLastCalledWith({
                status: "failed",
                errorCode: "conversion_failed",
            });
            expect(queryBuilder.set.mock.calls.at(-1)?.[0]).not.toHaveProperty(
                "filename",
            );
            expect(upload.saveStoredFile).not.toHaveBeenCalled();
            expect(await exists(job.sourcePath)).toBe(false);
        });

        it("maps a killed process to conversion_failed", async () => {
            await prepareJob();
            convertMock.mockRejectedValue(
                new MediaProcessError("killed", true),
            );

            await service.process(job);

            expect(queryBuilder.set).toHaveBeenLastCalledWith({
                status: "failed",
                errorCode: "conversion_failed",
            });
        });

        it("maps a size budget failure to output_too_large", async () => {
            await prepareJob();
            convertMock.mockRejectedValue(
                new ProfileVideoError("output_too_large"),
            );

            await service.process(job);

            expect(queryBuilder.set).toHaveBeenLastCalledWith({
                status: "failed",
                errorCode: "output_too_large",
            });
        });

        it("fails with source_missing when the queued source is gone", async () => {
            job.sourcePath = join(
                PROFILE_VIDEO_TEST_TEMP_ROOT,
                `missing-${randomUUID()}`,
            );
            repository.findOne.mockResolvedValue(row());

            await service.process(job);

            expect(convertMock).not.toHaveBeenCalled();
            expect(queryBuilder.set).toHaveBeenLastCalledWith({
                status: "failed",
                errorCode: "source_missing",
            });
        });

        it("fails with upload_failed and deletes a partially uploaded video", async () => {
            await prepareJob();
            upload.saveStoredFile
                .mockReset()
                .mockResolvedValueOnce({
                    fileName: "partial-video",
                    fileExt: "mp4",
                    fileNameWithExtension: "partial-video.mp4",
                })
                .mockRejectedValueOnce(new Error("S3 down"));

            await service.process(job);

            expect(queryBuilder.set).toHaveBeenLastCalledWith({
                status: "failed",
                errorCode: "upload_failed",
            });
            expect(upload.delete).toHaveBeenCalledWith("partial-video.mp4");
            expect(repository.manager.transaction).not.toHaveBeenCalled();
            expect(await exists(job.sourcePath)).toBe(false);
            expect(await exists(lastJobDirectory!)).toBe(false);
        });

        it("deletes its uploads when a newer attempt superseded it", async () => {
            await prepareJob();
            const fixtures = managerFixture();
            fixtures.videos.findOne.mockResolvedValue(
                row({ attemptId: "attempt-2" }),
            );
            repository.manager.transaction.mockImplementation(
                async (callback: (manager: unknown) => Promise<unknown>) =>
                    callback(fixtures.manager),
            );

            await service.process(job);

            expect(upload.delete.mock.calls).toEqual([
                ["new-video.mp4"],
                ["new-poster.jpeg"],
            ]);
            expect(queryBuilder.update).not.toHaveBeenCalled();
            expect(fixtures.profiles.save).not.toHaveBeenCalled();
            expect(await exists(job.sourcePath)).toBe(false);
            expect(await exists(lastJobDirectory!)).toBe(false);
        });

        it("skips work when the attempt is no longer current", async () => {
            job.sourcePath = await sourceFile();
            repository.findOne.mockResolvedValue(
                row({ attemptId: "attempt-2" }),
            );

            await service.process(job);

            expect(probeMock).not.toHaveBeenCalled();
            expect(convertMock).not.toHaveBeenCalled();
            expect(await exists(job.sourcePath)).toBe(false);
        });

        it("skips a duplicate job for an attempt that already finished", async () => {
            job.sourcePath = await sourceFile();
            repository.findOne.mockResolvedValue(row({ status: "ready" }));

            await service.process(job);

            expect(convertMock).not.toHaveBeenCalled();
            expect(await exists(job.sourcePath)).toBe(false);
        });

        it("deletes its uploads and fails when publication throws", async () => {
            await prepareJob();
            repository.manager.transaction.mockRejectedValue(
                new Error("db down"),
            );

            await service.process(job);

            expect(upload.delete.mock.calls).toEqual([
                ["new-video.mp4"],
                ["new-poster.jpeg"],
            ]);
            expect(queryBuilder.set).toHaveBeenLastCalledWith({
                status: "failed",
                errorCode: "conversion_failed",
            });
            expect(await exists(job.sourcePath)).toBe(false);
        });

        it("removes the per-job directory on success and failure", async () => {
            await prepareJob();
            let jobDirectory = "";
            convertMock.mockImplementation(
                async (_slot: string, _source: string, directory: string) => {
                    jobDirectory = directory;
                    const videoPath = join(directory, "video.mp4");
                    const posterPath = join(directory, "poster.jpg");
                    await writeFile(videoPath, "v");
                    await writeFile(posterPath, "p");
                    throw new ProfileVideoError("conversion_failed");
                },
            );

            await service.process(job);

            expect(jobDirectory).toContain(PROFILE_VIDEO_TEST_TEMP_ROOT);
            expect(await exists(jobDirectory)).toBe(false);
        });
    });

    describe("findForProfileRead", () => {
        function row(overrides: Partial<ProfileVideo> = {}): ProfileVideo {
            return {
                profileUserId: "user-1",
                type: "avatar",
                filename: "video-file",
                size: 812345,
                durationMs: 8000,
                width: 256,
                height: 256,
                status: "ready",
                attemptId: "attempt-1",
                errorCode: null,
                processingStartedAt: new Date(),
                ...overrides,
            } as ProfileVideo;
        }

        it("returns published details and the owner's attempts for a supporter", async () => {
            repository.find.mockResolvedValue([
                row(),
                row({
                    type: "banner",
                    filename: null,
                    status: "processing",
                    attemptId: "attempt-2",
                }),
            ]);

            await expect(
                service.findForProfileRead("user-1", true),
            ).resolves.toEqual({
                avatarVideo: {
                    filename: "video-file",
                    extension: "mp4",
                    mimetype: "video/mp4",
                    size: 812345,
                    durationMs: 8000,
                    width: 256,
                    height: 256,
                },
                bannerVideo: null,
                videoUploads: {
                    avatar: { status: "ready", errorCode: null },
                    banner: { status: "processing", errorCode: null },
                },
            });
            expect(billing.isSupporter).toHaveBeenCalledTimes(1);
        });

        it("keeps the previous video visible while a replacement attempts", async () => {
            repository.find.mockResolvedValue([
                row({
                    filename: "previous-video",
                    status: "processing",
                    attemptId: "attempt-2",
                }),
            ]);

            const result = await service.findForProfileRead("user-1", true);

            expect(result.avatarVideo?.filename).toBe("previous-video");
            expect(result.videoUploads?.avatar).toEqual({
                status: "processing",
                errorCode: null,
            });
        });

        it("hides published videos for a non-supporter but keeps owner statuses", async () => {
            billing.isSupporter.mockResolvedValue(false);
            repository.find.mockResolvedValue([row()]);

            const result = await service.findForProfileRead("user-1", true);

            expect(result.avatarVideo).toBeNull();
            expect(result.bannerVideo).toBeNull();
            expect(result.videoUploads?.avatar).toEqual({
                status: "ready",
                errorCode: null,
            });
        });

        it("returns null videos when the entitlement lookup fails", async () => {
            billing.isSupporter.mockRejectedValue(new Error("billing down"));
            repository.find.mockResolvedValue([row()]);

            await expect(
                service.findForProfileRead("user-1", false),
            ).resolves.toEqual({ avatarVideo: null, bannerVideo: null });
        });

        it("returns the same video when entitlement comes back without a write", async () => {
            repository.find.mockResolvedValue([row()]);
            billing.isSupporter
                .mockResolvedValueOnce(false)
                .mockResolvedValueOnce(true);

            const hidden = await service.findForProfileRead("user-1", false);
            const restored = await service.findForProfileRead("user-1", false);

            expect(hidden.avatarVideo).toBeNull();
            expect(restored.avatarVideo).toEqual({
                filename: "video-file",
                extension: "mp4",
                mimetype: "video/mp4",
                size: 812345,
                durationMs: 8000,
                width: 256,
                height: 256,
            });
            expect(repository.createQueryBuilder).not.toHaveBeenCalled();
            expect(repository.manager.transaction).not.toHaveBeenCalled();
        });

        it("reports a stale attempt as failed timeout without writing", async () => {
            repository.find.mockResolvedValue([
                row({
                    status: "processing",
                    processingStartedAt: new Date(
                        Date.now() - PROFILE_VIDEO_STALE_MS - 1,
                    ),
                }),
            ]);

            const result = await service.findForProfileRead("user-1", true);

            expect(result.avatarVideo?.filename).toBe("video-file");
            expect(result.videoUploads?.avatar).toEqual({
                status: "failed",
                errorCode: "timeout",
            });
            expect(repository.createQueryBuilder).not.toHaveBeenCalled();
            expect(repository.manager.transaction).not.toHaveBeenCalled();
        });

        it("reports a row without a status as null", async () => {
            repository.find.mockResolvedValue([
                row({ status: null, filename: null }),
            ]);

            const result = await service.findForProfileRead("user-1", true);

            expect(result.videoUploads).toEqual({
                avatar: null,
                banner: null,
            });
            expect(billing.isSupporter).not.toHaveBeenCalled();
        });

        it("does not look up entitlement without a published video", async () => {
            repository.find.mockResolvedValue([
                row({ filename: null, status: "failed", errorCode: "timeout" }),
            ]);

            const result = await service.findForProfileRead("user-1", true);

            expect(result.avatarVideo).toBeNull();
            expect(billing.isSupporter).not.toHaveBeenCalled();
        });

        it("omits upload statuses from the public read", async () => {
            repository.find.mockResolvedValue([row()]);

            const result = await service.findForProfileRead("user-1", false);

            expect(result).not.toHaveProperty("videoUploads");
        });
    });

    it("exposes the rows and a non-throwing entitlement lookup for reads", async () => {
        const rows = [{ filename: "video" }];
        repository.find.mockResolvedValue(rows as never);
        await expect(service.findByUserId("user-1")).resolves.toBe(rows);
        expect(repository.find).toHaveBeenCalledWith({
            where: { profileUserId: "user-1" },
        });

        billing.isSupporter.mockRejectedValue(new Error("db down"));
        await expect(service.isSupporter("user-1")).resolves.toBe(false);
    });
});
