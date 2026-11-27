jest.mock("../statistics/statistics-target.repository", () => ({
    cleanupStatisticsProfile: jest.fn(async () => undefined),
}));

import { ArgumentMetadata, ValidationPipe } from "@nestjs/common";
import { getMetadataArgsStorage, In } from "typeorm";
import { ProfileService } from "./profile.service";
import { Profile } from "./entities/profile.entity";
import { ProfileAvatar } from "./entities/profile-avatar.entity";
import { ProfileBanner } from "./entities/profile-banner.entity";
import { ProfileVideo } from "./entities/profile-video.entity";
import { UpdateProfileImageDto } from "./dto/update-profile-image.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { CustomCoverMode } from "../game/game-cover/game-cover.constants";
import { LibraryVisibility } from "../libraries/library-visibility.constants";
import { lockoutAuthService } from "../../test/mocks/lockout-auth-service.mock";

function imageFile(): Express.Multer.File {
    return {
        encoding: "7bit",
        mimetype: "image/png",
        size: 12,
        buffer: Buffer.from("image"),
    } as Express.Multer.File;
}

function updateFixture() {
    const events: string[] = [];
    const previousAvatar = {
        id: 3,
        filename: "old-avatar",
        extension: "png",
    };
    const videoRow = {
        id: 9,
        filename: "old-video",
        type: "avatar",
        status: "processing",
    };
    const avatars = {
        create: jest.fn((details) => ({ id: 4, ...details })),
        save: jest.fn(async (image) => {
            events.push("save-image");
            return image;
        }),
        delete: jest.fn(async () => {
            events.push("delete-old-image-row");
        }),
    };
    const banners = {
        create: jest.fn((details) => ({ id: 5, ...details })),
        save: jest.fn(async (image) => image),
        delete: jest.fn(async () => undefined),
    };
    const videos = {
        findOne: jest.fn(async () => {
            events.push("lock-video");
            return videoRow;
        }),
        delete: jest.fn(async () => {
            events.push("delete-video-row");
        }),
    };
    const profiles = {
        findOne: jest.fn(async () => {
            events.push("read-images");
            return { userId: "user-1", avatar: previousAvatar, banner: null };
        }),
        save: jest.fn(async (profile) => {
            events.push("save-profile");
            return profile;
        }),
    };
    const manager = {
        getRepository: jest.fn((entity: unknown) => {
            if (entity === ProfileVideo) return videos;
            if (entity === Profile) return profiles;
            if (entity === ProfileAvatar) return avatars;
            if (entity === ProfileBanner) return banners;
            throw new Error("Unexpected repository");
        }),
    };
    const profileRepository = {
        findOne: jest.fn(async () => ({ userId: "user-1" })),
        manager: {
            transaction: jest.fn(async (callback: (m: unknown) => unknown) => {
                events.push("begin");
                const result = await callback(manager);
                events.push("commit");
                return result;
            }),
        },
    };
    const upload = {
        save: jest.fn(async () => ({
            fileName: "new-avatar",
            fileExt: "png",
        })),
        delete: jest.fn(async (key: string) => {
            events.push(`delete-object:${key}`);
        }),
    };
    const service = new ProfileService(
        profileRepository as never,
        {} as never,
        {} as never,
        upload as never,
    );

    return {
        service,
        events,
        avatars,
        banners,
        videos,
        profiles,
        profileRepository,
        upload,
        previousAvatar,
        videoRow,
    };
}

function deletionFixture() {
    const events: string[] = [];
    const transactionProfileRepository = {
        findOne: jest.fn(async () => {
            events.push("lock-profile");
            return { userId: "user-1" };
        }),
        delete: jest.fn(async () => {
            events.push("delete-profile");
        }),
    };
    const manager = {
        getRepository: jest.fn(() => transactionProfileRepository),
    };
    const profileRepository = {
        findOne: jest.fn(async () => {
            events.push("read-media");
            return {
                userId: "user-1",
                avatar: { filename: "old-avatar", extension: "png" },
                banner: { filename: "old-banner", extension: "jpeg" },
            };
        }),
        manager: {
            transaction: jest.fn(async (callback: (m: unknown) => unknown) => {
                events.push("begin");
                await callback(manager);
                events.push("commit");
            }),
        },
    };
    const profileVideoRepository = {
        find: jest.fn(async () => {
            events.push("read-videos");
            return [{ filename: "old-video" }, { filename: null }];
        }),
    };
    const notifications = {
        invalidateProfile: jest.fn(async () => {
            events.push("invalidate");
        }),
    };
    const upload = {
        delete: jest.fn(async (key: string) => {
            events.push(`delete-object:${key}`);
        }),
    };
    const service = new ProfileService(
        profileRepository as never,
        profileVideoRepository as never,
        {} as never,
        upload as never,
        notifications as never,
    );

    return { service, events, profileRepository, upload };
}

describe("ProfileService", () => {
    it("reports isSuspended for an active expiring lockout and isBanned for a permanent one", async () => {
        const day = 24 * 60 * 60 * 1000;
        const ids = ["active", "suspended", "expired", "banned", "no-user"];
        const service = new ProfileService(
            { find: async () => ids.map((userId) => ({ userId })) } as any,
            {} as any,
            lockoutAuthService([
                { id: "active", banned: false },
                {
                    id: "suspended",
                    banned: true,
                    banExpires: new Date(Date.now() + day),
                },
                {
                    id: "expired",
                    banned: true,
                    banExpires: new Date(Date.now() - day),
                },
                { id: "banned", banned: true, banExpires: null },
            ]),
            {} as any,
        );

        const result = await service.findAll();

        expect(
            Object.fromEntries(
                result.map(({ profile, isSuspended, isBanned }) => [
                    profile.userId,
                    { isSuspended, isBanned },
                ]),
            ),
        ).toEqual({
            active: { isSuspended: false, isBanned: false },
            suspended: { isSuspended: true, isBanned: false },
            expired: { isSuspended: false, isBanned: false },
            banned: { isSuspended: false, isBanned: true },
            "no-user": { isSuspended: false, isBanned: false },
        });
    });

    describe("updateProfileImage", () => {
        const dto = { type: "avatar" } as UpdateProfileImageDto;

        it("keeps the old image and video when storing the new file fails", async () => {
            const fixture = updateFixture();
            fixture.upload.save.mockRejectedValue(new Error("S3 down"));

            await expect(
                fixture.service.updateProfileImage("user-1", dto, imageFile()),
            ).rejects.toMatchObject({ status: 500 });

            expect(
                fixture.profileRepository.manager.transaction,
            ).not.toHaveBeenCalled();
            expect(fixture.avatars.delete).not.toHaveBeenCalled();
            expect(fixture.videos.delete).not.toHaveBeenCalled();
            expect(fixture.upload.delete).not.toHaveBeenCalled();
        });

        it("locks the video row before reading images and deletes objects after commit", async () => {
            const fixture = updateFixture();

            await fixture.service.updateProfileImage(
                "user-1",
                dto,
                imageFile(),
            );

            expect(fixture.videos.findOne).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { profileUserId: "user-1", type: "avatar" },
                    lock: { mode: "pessimistic_write" },
                }),
            );
            expect(fixture.videos.delete).toHaveBeenCalledWith(
                fixture.videoRow.id,
            );
            expect(fixture.events).toEqual([
                "begin",
                "lock-video",
                "read-images",
                "save-image",
                "save-profile",
                "delete-old-image-row",
                "delete-video-row",
                "commit",
                "delete-object:old-avatar.png",
                "delete-object:old-video.mp4",
            ]);
        });

        it("deletes the poster the worker published first as the old image", async () => {
            const fixture = updateFixture();
            fixture.profiles.findOne.mockResolvedValue({
                userId: "user-1",
                avatar: {
                    id: 11,
                    filename: "worker-poster",
                    extension: "jpeg",
                },
                banner: null,
            });

            await fixture.service.updateProfileImage(
                "user-1",
                dto,
                imageFile(),
            );

            expect(fixture.avatars.delete).toHaveBeenCalledWith(11);
            expect(fixture.upload.delete.mock.calls).toEqual([
                ["worker-poster.jpeg"],
                ["old-video.mp4"],
            ]);
        });

        it("replaces a published banner video when saving a static banner", async () => {
            const fixture = updateFixture();
            const previousBanner = {
                id: 6,
                filename: "old-banner",
                extension: "png",
            };
            fixture.profiles.findOne.mockResolvedValue({
                userId: "user-1",
                avatar: null,
                banner: previousBanner,
            } as never);
            fixture.videos.findOne.mockResolvedValue({
                ...fixture.videoRow,
                type: "banner",
            });
            fixture.upload.save.mockResolvedValue({
                fileName: "new-banner",
                fileExt: "png",
            });

            await fixture.service.updateProfileImage(
                "user-1",
                { type: "banner" } as UpdateProfileImageDto,
                imageFile(),
            );

            expect(fixture.videos.findOne).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { profileUserId: "user-1", type: "banner" },
                }),
            );
            expect(fixture.banners.delete).toHaveBeenCalledWith(
                previousBanner.id,
            );
            expect(fixture.videos.delete).toHaveBeenCalledWith(
                fixture.videoRow.id,
            );
            expect(fixture.profiles.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    banner: expect.objectContaining({ id: 5 }),
                }),
            );
            expect(fixture.avatars.save).not.toHaveBeenCalled();
            expect(fixture.upload.delete.mock.calls).toEqual([
                ["old-banner.png"],
                ["old-video.mp4"],
            ]);
        });

        it("does not fail the request when object deletion fails", async () => {
            const fixture = updateFixture();
            fixture.upload.delete.mockImplementation(async (key: string) => {
                if (key === "old-avatar.png") throw new Error("S3 down");
            });

            await expect(
                fixture.service.updateProfileImage("user-1", dto, imageFile()),
            ).resolves.toBeUndefined();

            expect(fixture.upload.delete.mock.calls).toEqual([
                ["old-avatar.png"],
                ["old-video.mp4"],
            ]);
        });
    });

    describe("findOneById", () => {
        it("returns a stored GIF avatar unchanged", async () => {
            const fixture = updateFixture();
            const gifAvatar = {
                id: 1,
                filename: "legacy-avatar",
                extension: "gif",
                mimetype: "image/gif",
            };
            const profile = {
                userId: "user-1",
                avatar: gifAvatar,
                banner: null,
            };
            fixture.profileRepository.findOne.mockResolvedValue(profile);

            await expect(
                fixture.service.findOneById("user-1"),
            ).resolves.toBe(profile);
            expect(fixture.profileRepository.findOne).toHaveBeenCalledWith({
                where: { userId: "user-1" },
                relations: { avatar: true, banner: true },
            });
        });
    });

    describe("findManyByIds", () => {
        it("loads profiles with avatar and banner in one query", async () => {
            const profiles = [{ userId: "user-1" }, { userId: "user-2" }];
            const find = jest.fn(async () => profiles);
            const service = new ProfileService(
                { find } as never,
                {} as never,
                {} as never,
                {} as never,
            );

            await expect(
                service.findManyByIds(["user-1", "user-2"]),
            ).resolves.toBe(profiles);
            expect(find).toHaveBeenCalledWith({
                where: { userId: In(["user-1", "user-2"]) },
                relations: { avatar: true, banner: true },
            });
        });

        it("returns no rows without querying for an empty batch", async () => {
            const find = jest.fn();
            const service = new ProfileService(
                { find } as never,
                {} as never,
                {} as never,
                {} as never,
            );

            await expect(service.findManyByIds([])).resolves.toEqual([]);
            expect(find).not.toHaveBeenCalled();
        });
    });

    describe("deleteByUserId", () => {
        it("deletes avatar, banner and video objects only after commit", async () => {
            const fixture = deletionFixture();

            await fixture.service.deleteByUserId("user-1");

            expect(fixture.events).toEqual([
                "read-media",
                "read-videos",
                "begin",
                "lock-profile",
                "invalidate",
                "delete-profile",
                "commit",
                "delete-object:old-avatar.png",
                "delete-object:old-banner.jpeg",
                "delete-object:old-video.mp4",
            ]);
        });

        it("does not fail when an object deletion fails", async () => {
            const fixture = deletionFixture();
            fixture.upload.delete.mockRejectedValue(new Error("S3 down"));

            await expect(
                fixture.service.deleteByUserId("user-1"),
            ).resolves.toBeUndefined();
        });
    });

    describe("customCoverMode", () => {
        it("defaults to any", () => {
            const column = getMetadataArgsStorage().columns.find(
                (column) =>
                    column.target === Profile &&
                    column.propertyName === "customCoverMode",
            );

            expect(column?.options.default).toBe(CustomCoverMode.Any);
        });

        it("stores a valid mode and leaves other fields unchanged", async () => {
            const profile = {
                userId: "user-1",
                username: "me",
                bio: "old bio",
                customCoverMode: CustomCoverMode.Any,
            };
            const profileRepository = {
                findOne: jest.fn(async () => ({ ...profile })),
                save: jest.fn(async (value) => value),
            };
            const service = new ProfileService(
                profileRepository as never,
                {} as never,
                {} as never,
                {} as never,
            );

            await service.update("user-1", {
                customCoverMode: CustomCoverMode.PreferYours,
            });

            expect(profileRepository.save).toHaveBeenCalledWith({
                ...profile,
                customCoverMode: CustomCoverMode.PreferYours,
            });
        });

        it("rejects an invalid mode with 400 and accepts a valid one", async () => {
            const pipe = new ValidationPipe({ transform: true });
            const metadata: ArgumentMetadata = {
                type: "body",
                metatype: UpdateProfileDto,
            };

            await expect(
                pipe.transform({ customCoverMode: "sometimes" }, metadata),
            ).rejects.toMatchObject({ status: 400 });
            await expect(
                pipe.transform(
                    { customCoverMode: CustomCoverMode.None },
                    metadata,
                ),
            ).resolves.toMatchObject({
                customCoverMode: CustomCoverMode.None,
            });
        });
    });

    describe("libraryVisibility", () => {
        function fixtureFor(profile: Record<string, unknown>) {
            const profileRepository = {
                findOne: jest.fn(async () => ({ ...profile })),
                save: jest.fn(async (value) => value),
            };
            const notifications = {
                invalidateLibraryContent: jest.fn(async () => undefined),
            };
            const service = new ProfileService(
                profileRepository as never,
                {} as never,
                {} as never,
                {} as never,
                notifications as never,
            );

            return { service, profileRepository, notifications };
        }

        it("defaults to public", () => {
            const column = getMetadataArgsStorage().columns.find(
                (column) =>
                    column.target === Profile &&
                    column.propertyName === "libraryVisibility",
            );

            expect(column?.options.default).toBe(LibraryVisibility.Public);
        });

        it("stores a valid level, keeps other fields and invalidates notifications", async () => {
            const profile = {
                userId: "user-1",
                username: "me",
                bio: "old bio",
                customCoverMode: CustomCoverMode.Any,
                libraryVisibility: LibraryVisibility.Public,
            };
            const { service, profileRepository, notifications } =
                fixtureFor(profile);

            await service.update("user-1", {
                libraryVisibility: LibraryVisibility.Followers,
            });

            expect(profileRepository.save).toHaveBeenCalledWith({
                ...profile,
                libraryVisibility: LibraryVisibility.Followers,
            });
            expect(notifications.invalidateLibraryContent).toHaveBeenCalledWith(
                "user-1",
            );
        });

        it("rejects an invalid level with 400 and accepts a valid one", async () => {
            const pipe = new ValidationPipe({ transform: true });
            const metadata: ArgumentMetadata = {
                type: "body",
                metatype: UpdateProfileDto,
            };

            await expect(
                pipe.transform({ libraryVisibility: "friends" }, metadata),
            ).rejects.toMatchObject({ status: 400 });
            await expect(
                pipe.transform(
                    { libraryVisibility: LibraryVisibility.Private },
                    metadata,
                ),
            ).resolves.toMatchObject({
                libraryVisibility: LibraryVisibility.Private,
            });
        });

        it.each([
            [
                "public to followers",
                LibraryVisibility.Public,
                LibraryVisibility.Followers,
                1,
            ],
            [
                "followers to private",
                LibraryVisibility.Followers,
                LibraryVisibility.Private,
                1,
            ],
            [
                "public to private",
                LibraryVisibility.Public,
                LibraryVisibility.Private,
                1,
            ],
            [
                "private to followers",
                LibraryVisibility.Private,
                LibraryVisibility.Followers,
                0,
            ],
            [
                "followers to followers",
                LibraryVisibility.Followers,
                LibraryVisibility.Followers,
                0,
            ],
            [
                "followers with the level omitted",
                LibraryVisibility.Followers,
                undefined,
                0,
            ],
        ])(
            "invalidates notifications only when the level becomes stricter: %s",
            async (_case, stored, requested, expectedCalls) => {
                const { service, notifications } = fixtureFor({
                    userId: "user-1",
                    libraryVisibility: stored,
                });

                await service.update("user-1", {
                    libraryVisibility: requested,
                });

                expect(
                    notifications.invalidateLibraryContent,
                ).toHaveBeenCalledTimes(expectedCalls);
            },
        );
    });
});
