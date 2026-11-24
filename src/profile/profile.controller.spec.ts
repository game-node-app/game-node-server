import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import sharp from "sharp";
import { ProfileController } from "./profile.controller";
import { ProfileService } from "./profile.service";
import { ProfileVideoService } from "./profile-video/profile-video.service";
import { SupporterPreferencesService } from "./supporter-preferences/supporter-preferences.service";
import { SUPPORTER_PREFERENCES_DEFAULTS } from "./supporter-preferences/supporter-preferences.defaults";
import { AuthService } from "../auth/auth.service";
import { LibraryAccessService } from "../libraries/library-access.service";
import { LibraryVisibility } from "../libraries/library-visibility.constants";
import { BillingService } from "../billing/billing.service";

const GIF = Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    "base64",
);
const SVG = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>',
);

function encoded(format: "png" | "jpeg" | "webp"): Promise<Buffer> {
    const image = sharp({
        create: {
            width: 2,
            height: 2,
            channels: 3,
            background: { r: 255, g: 0, b: 0 },
        },
    });
    if (format === "png") return image.png().toBuffer();
    if (format === "jpeg") return image.jpeg().toBuffer();
    return image.webp().toBuffer();
}

describe("ProfileController", () => {
    let app: INestApplication;
    let controller: ProfileController;
    let profileService: {
        findOneByIdOrFail: jest.Mock;
        findManyByIds: jest.Mock;
        updateProfileImage: jest.Mock;
    };
    let profileVideoService: {
        isSupporter: jest.Mock;
        findForProfileRead: jest.Mock;
        findForProfileReadMany: jest.Mock;
    };
    let supporterPreferencesService: {
        findOrDefaults: jest.Mock;
        findOrDefaultsMany: jest.Mock;
    };
    let libraryAccessService: { resolve: jest.Mock; resolveMany: jest.Mock };
    let billingService: { findSupporterUserIdsIn: jest.Mock };
    let getSession: jest.Mock;

    beforeEach(async () => {
        getSession = jest.fn(async () => ({
            user: { id: "user-1", role: "user" },
        }));
        profileService = {
            findOneByIdOrFail: jest.fn(),
            findManyByIds: jest.fn(async () => []),
            updateProfileImage: jest.fn(async () => undefined),
        };
        profileVideoService = {
            isSupporter: jest.fn(async () => false),
            findForProfileRead: jest.fn(async () => ({
                avatarVideo: null,
                bannerVideo: null,
            })),
            findForProfileReadMany: jest.fn(async () => new Map()),
        };
        supporterPreferencesService = {
            findOrDefaults: jest.fn(async () => ({
                ...SUPPORTER_PREFERENCES_DEFAULTS,
            })),
            findOrDefaultsMany: jest.fn(async () => new Map()),
        };
        libraryAccessService = {
            resolve: jest.fn(async () => ({
                audience: "everyone",
                libraryVisibility: LibraryVisibility.Public,
                canViewLibrary: true,
                visibleEntryLevels: [LibraryVisibility.Public],
            })),
            resolveMany: jest.fn(async () => new Map()),
        };
        billingService = {
            findSupporterUserIdsIn: jest.fn(async () => new Set<string>()),
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [ProfileController],
            providers: [
                {
                    provide: AuthService,
                    useValue: {
                        getSession,
                    },
                },
                { provide: ProfileService, useValue: profileService },
                {
                    provide: ProfileVideoService,
                    useValue: profileVideoService,
                },
                {
                    provide: SupporterPreferencesService,
                    useValue: supporterPreferencesService,
                },
                {
                    provide: LibraryAccessService,
                    useValue: libraryAccessService,
                },
                { provide: BillingService, useValue: billingService },
            ],
        }).compile();

        app = module.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.init();
        controller = module.get<ProfileController>(ProfileController);
    });

    afterEach(async () => {
        await app.close();
    });

    function upload(buffer: Buffer, contentType: string, filename: string) {
        return request(app.getHttpServer())
            .put("/profile/image")
            .field("type", "avatar")
            .attach("file", buffer, { filename, contentType });
    }

    it("should be defined", () => {
        expect(controller).toBeDefined();
    });

    it("returns owner upload statuses from GET /profile", async () => {
        profileService.findOneByIdOrFail.mockResolvedValue({
            userId: "user-1",
            username: "me",
            customCoverMode: "any",
            libraryVisibility: LibraryVisibility.Followers,
        });
        profileVideoService.findForProfileRead.mockResolvedValue({
            avatarVideo: null,
            bannerVideo: null,
            videoUploads: {
                avatar: { status: "ready", errorCode: null },
                banner: null,
            },
        });

        const response = await request(app.getHttpServer()).get("/profile");

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
            userId: "user-1",
            username: "me",
            customCoverMode: "any",
            libraryVisibility: LibraryVisibility.Followers,
            canViewLibrary: true,
            isSupporter: false,
            supporterPreferences: null,
            avatarVideo: null,
            bannerVideo: null,
            videoUploads: {
                avatar: { status: "ready", errorCode: null },
                banner: null,
            },
        });
        expect(profileVideoService.findForProfileRead).toHaveBeenCalledWith(
            "user-1",
            true,
            false,
        );
        expect(
            supporterPreferencesService.findOrDefaults,
        ).not.toHaveBeenCalled();
    });

    it("returns a supporter's preferences and published videos", async () => {
        profileService.findOneByIdOrFail.mockResolvedValue({
            userId: "user-2",
            username: "them",
        });
        profileVideoService.isSupporter.mockResolvedValue(true);
        profileVideoService.findForProfileRead.mockResolvedValue({
            avatarVideo: {
                filename: "ab12",
                extension: "mp4",
                mimetype: "video/mp4",
                size: 812345,
                durationMs: 8000,
                width: 256,
                height: 256,
            },
            bannerVideo: null,
        });
        const preferences = {
            ...SUPPORTER_PREFERENCES_DEFAULTS,
            showBadge: false,
            titleKey: "founder",
            accentColor: "#FF8800",
        };
        supporterPreferencesService.findOrDefaults.mockResolvedValue(
            preferences,
        );

        const response = await request(app.getHttpServer()).get(
            "/profile/user-2",
        );

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
            userId: "user-2",
            isSupporter: true,
            supporterPreferences: preferences,
            avatarVideo: { filename: "ab12", extension: "mp4" },
            bannerVideo: null,
        });
        expect(profileVideoService.isSupporter).toHaveBeenCalledTimes(1);
        expect(profileVideoService.findForProfileRead).toHaveBeenCalledWith(
            "user-2",
            false,
            true,
        );
        expect(supporterPreferencesService.findOrDefaults).toHaveBeenCalledWith(
            "user-2",
        );
    });

    it("omits upload statuses from GET /profile/:id", async () => {
        profileService.findOneByIdOrFail.mockResolvedValue({
            userId: "user-2",
            username: "them",
        });

        const response = await request(app.getHttpServer()).get(
            "/profile/user-2",
        );

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            userId: "user-2",
            username: "them",
            libraryVisibility: LibraryVisibility.Public,
            canViewLibrary: true,
            isSupporter: false,
            supporterPreferences: null,
            avatarVideo: null,
            bannerVideo: null,
        });
        expect(response.body).not.toHaveProperty("videoUploads");
        expect(profileVideoService.findForProfileRead).toHaveBeenCalledWith(
            "user-2",
            false,
            false,
        );
    });

    it("returns 200 with false and null when the entitlement lookup throws", async () => {
        const billing = {
            isSupporter: jest.fn(async () => {
                throw new Error("billing down");
            }),
        };
        const videoRepository = { find: jest.fn(async () => []) };
        const videoService = new ProfileVideoService(
            videoRepository as never,
            {} as never,
            billing as never,
            {} as never,
        );
        profileService.findOneByIdOrFail.mockResolvedValue({
            userId: "user-2",
            username: "them",
        });

        const module = await Test.createTestingModule({
            controllers: [ProfileController],
            providers: [
                {
                    provide: AuthService,
                    useValue: {
                        getSession: jest.fn(async () => ({
                            user: { id: "user-1", role: "user" },
                        })),
                    },
                },
                { provide: ProfileService, useValue: profileService },
                { provide: ProfileVideoService, useValue: videoService },
                {
                    provide: SupporterPreferencesService,
                    useValue: supporterPreferencesService,
                },
                {
                    provide: LibraryAccessService,
                    useValue: libraryAccessService,
                },
                { provide: BillingService, useValue: billingService },
            ],
        }).compile();
        const isolatedApp = module.createNestApplication();
        await isolatedApp.init();

        try {
            const response = await request(isolatedApp.getHttpServer()).get(
                "/profile/user-2",
            );

            expect(response.status).toBe(200);
            expect(response.body.isSupporter).toBe(false);
            expect(response.body.supporterPreferences).toBeNull();
            expect(videoRepository.find).not.toHaveBeenCalled();
            expect(
                supporterPreferencesService.findOrDefaults,
            ).not.toHaveBeenCalled();
        } finally {
            await isolatedApp.close();
        }
    });

    it("does not read stored preferences for a lapsed supporter", async () => {
        profileService.findOneByIdOrFail.mockResolvedValue({
            userId: "user-2",
            username: "them",
        });
        supporterPreferencesService.findOrDefaults.mockResolvedValue({
            ...SUPPORTER_PREFERENCES_DEFAULTS,
            titleKey: "founder",
        });

        const response = await request(app.getHttpServer()).get(
            "/profile/user-2",
        );

        expect(response.status).toBe(200);
        expect(response.body.supporterPreferences).toBeNull();
        expect(
            supporterPreferencesService.findOrDefaults,
        ).not.toHaveBeenCalled();
    });

    it("touches only the profile and entitlement for a public non-supporter read", async () => {
        profileService.findOneByIdOrFail.mockResolvedValue({
            userId: "user-2",
            username: "them",
        });

        const response = await request(app.getHttpServer()).get(
            "/profile/user-2",
        );

        expect(response.status).toBe(200);
        expect(response.body.isSupporter).toBe(false);
        expect(response.body.supporterPreferences).toBeNull();
        expect(profileService.findOneByIdOrFail).toHaveBeenCalledTimes(1);
        expect(profileVideoService.isSupporter).toHaveBeenCalledTimes(1);
        // The video service skips its query when the third argument is false.
        expect(profileVideoService.findForProfileRead).toHaveBeenCalledWith(
            "user-2",
            false,
            false,
        );
        expect(
            supporterPreferencesService.findOrDefaults,
        ).not.toHaveBeenCalled();
    });

    describe("POST /profile/all", () => {
        function profileOf(
            userId: string,
            libraryVisibility = LibraryVisibility.Public,
        ) {
            return {
                userId,
                username: userId,
                avatar: null,
                banner: null,
                customCoverMode: "any",
                libraryVisibility,
            };
        }

        function accessOf(
            libraryVisibility: LibraryVisibility,
            canViewLibrary: boolean,
        ) {
            return {
                audience: "everyone",
                libraryVisibility,
                canViewLibrary,
                visibleEntryLevels: canViewLibrary
                    ? [LibraryVisibility.Public]
                    : [],
            };
        }

        it("returns found profiles in request order without duplicates or missing ids", async () => {
            getSession.mockResolvedValue(null);
            const profiles = [profileOf("user-2"), profileOf("user-1")];
            profileService.findManyByIds.mockResolvedValue(profiles);
            libraryAccessService.resolveMany.mockResolvedValue(
                new Map([
                    ["user-2", accessOf(LibraryVisibility.Public, true)],
                    ["user-1", accessOf(LibraryVisibility.Private, false)],
                ]),
            );

            const response = await request(app.getHttpServer())
                .post("/profile/all")
                .send({ userIds: ["user-2", "user-1", "user-2", "missing"] });

            expect(response.status).toBe(200);
            expect(
                (response.body as Array<{ userId: string }>).map(
                    (profile) => profile.userId,
                ),
            ).toEqual(["user-2", "user-1"]);
            expect(profileService.findManyByIds).toHaveBeenCalledWith([
                "user-2",
                "user-1",
                "missing",
            ]);
            expect(libraryAccessService.resolveMany).toHaveBeenCalledWith(
                undefined,
                profiles,
            );
            expect(response.body[0]).toMatchObject({
                userId: "user-2",
                username: "user-2",
                libraryVisibility: LibraryVisibility.Public,
                canViewLibrary: true,
                isSupporter: false,
                supporterPreferences: null,
                avatar: null,
                banner: null,
                avatarVideo: null,
                bannerVideo: null,
            });
            expect(response.body[1]).toMatchObject({
                userId: "user-1",
                libraryVisibility: LibraryVisibility.Private,
                canViewLibrary: false,
            });
            expect(response.body[0]).not.toHaveProperty("videoUploads");
            expect(
                profileVideoService.findForProfileRead,
            ).not.toHaveBeenCalled();
            expect(
                supporterPreferencesService.findOrDefaults,
            ).not.toHaveBeenCalled();
        });

        it("evaluates canViewLibrary per profile for the signed-in viewer", async () => {
            const profiles = [
                profileOf("owner", LibraryVisibility.Private),
                profileOf("followed", LibraryVisibility.Followers),
                profileOf("stranger", LibraryVisibility.Private),
                profileOf("everyone", LibraryVisibility.Public),
            ];
            profileService.findManyByIds.mockResolvedValue(profiles);
            libraryAccessService.resolveMany.mockResolvedValue(
                new Map([
                    ["owner", accessOf(LibraryVisibility.Private, true)],
                    ["followed", accessOf(LibraryVisibility.Followers, true)],
                    ["stranger", accessOf(LibraryVisibility.Private, false)],
                    ["everyone", accessOf(LibraryVisibility.Public, true)],
                ]),
            );

            const response = await request(app.getHttpServer())
                .post("/profile/all")
                .send({
                    userIds: ["owner", "followed", "stranger", "everyone"],
                });

            expect(response.status).toBe(200);
            const items = response.body as Array<{
                userId: string;
                canViewLibrary: boolean;
                libraryVisibility: LibraryVisibility;
            }>;
            expect(items.map(({ canViewLibrary }) => canViewLibrary)).toEqual([
                true,
                true,
                false,
                true,
            ]);
            expect(
                items.map(({ libraryVisibility }) => libraryVisibility),
            ).toEqual([
                LibraryVisibility.Private,
                LibraryVisibility.Followers,
                LibraryVisibility.Private,
                LibraryVisibility.Public,
            ]);
            expect(libraryAccessService.resolveMany).toHaveBeenCalledTimes(1);
            expect(libraryAccessService.resolveMany).toHaveBeenCalledWith(
                "user-1",
                profiles,
            );
            expect(libraryAccessService.resolve).not.toHaveBeenCalled();
        });

        it("only reads videos and preferences for supporters", async () => {
            const profiles = [profileOf("user-1"), profileOf("user-2")];
            profileService.findManyByIds.mockResolvedValue(profiles);
            billingService.findSupporterUserIdsIn.mockResolvedValue(
                new Set(["user-2"]),
            );
            libraryAccessService.resolveMany.mockResolvedValue(
                new Map([
                    ["user-1", accessOf(LibraryVisibility.Public, true)],
                    ["user-2", accessOf(LibraryVisibility.Public, true)],
                ]),
            );
            profileVideoService.findForProfileReadMany.mockResolvedValue(
                new Map([
                    [
                        "user-2",
                        {
                            avatarVideo: {
                                filename: "ab12",
                                extension: "mp4",
                            },
                            bannerVideo: null,
                        },
                    ],
                ]),
            );
            const preferences = {
                ...SUPPORTER_PREFERENCES_DEFAULTS,
                titleKey: "founder",
            };
            supporterPreferencesService.findOrDefaultsMany.mockResolvedValue(
                new Map([["user-2", preferences]]),
            );

            const response = await request(app.getHttpServer())
                .post("/profile/all")
                .send({ userIds: ["user-1", "user-2"] });

            expect(response.status).toBe(200);
            expect(response.body[0]).toMatchObject({
                userId: "user-1",
                isSupporter: false,
                supporterPreferences: null,
                avatarVideo: null,
                bannerVideo: null,
            });
            expect(response.body[1]).toMatchObject({
                userId: "user-2",
                isSupporter: true,
                supporterPreferences: preferences,
                avatarVideo: { filename: "ab12", extension: "mp4" },
                bannerVideo: null,
            });
            expect(
                profileVideoService.findForProfileReadMany,
            ).toHaveBeenCalledTimes(1);
            expect(
                profileVideoService.findForProfileReadMany,
            ).toHaveBeenCalledWith(["user-2"]);
            expect(
                supporterPreferencesService.findOrDefaultsMany,
            ).toHaveBeenCalledWith(["user-2"]);
            expect(profileVideoService.isSupporter).not.toHaveBeenCalled();
            expect(
                supporterPreferencesService.findOrDefaults,
            ).not.toHaveBeenCalled();
        });

        it.each([
            ["an empty", []],
            [
                "an oversized",
                Array.from({ length: 101 }, (_, index) => `user-${index}`),
            ],
            ["a non-string", [1, 2]],
        ])("rejects %s userIds array with 400", async (_case, userIds) => {
            const response = await request(app.getHttpServer())
                .post("/profile/all")
                .send({ userIds });

            expect(response.status).toBe(400);
            expect(profileService.findManyByIds).not.toHaveBeenCalled();
        });
    });

    describe("library visibility", () => {
        it("returns the stored level and canViewLibrary true for the owner", async () => {
            profileService.findOneByIdOrFail.mockResolvedValue({
                userId: "user-1",
                username: "me",
                libraryVisibility: LibraryVisibility.Private,
            });

            const response = await request(app.getHttpServer()).get("/profile");

            expect(response.status).toBe(200);
            expect(response.body).toMatchObject({
                libraryVisibility: LibraryVisibility.Private,
                canViewLibrary: true,
            });
            expect(libraryAccessService.resolve).not.toHaveBeenCalled();
        });

        it("reports a private library as hidden to an anonymous viewer", async () => {
            getSession.mockResolvedValue(null);
            profileService.findOneByIdOrFail.mockResolvedValue({
                userId: "user-2",
                username: "them",
                libraryVisibility: LibraryVisibility.Private,
            });
            libraryAccessService.resolve.mockResolvedValue({
                audience: "everyone",
                libraryVisibility: LibraryVisibility.Private,
                canViewLibrary: false,
                visibleEntryLevels: [],
            });

            const response = await request(app.getHttpServer()).get(
                "/profile/user-2",
            );

            expect(response.status).toBe(200);
            expect(response.body).toMatchObject({
                libraryVisibility: LibraryVisibility.Private,
                canViewLibrary: false,
            });
            expect(libraryAccessService.resolve).toHaveBeenCalledWith(
                undefined,
                "user-2",
            );
        });

        it("reports a followers library as visible to a follower", async () => {
            profileService.findOneByIdOrFail.mockResolvedValue({
                userId: "user-2",
                username: "them",
                libraryVisibility: LibraryVisibility.Followers,
            });
            libraryAccessService.resolve.mockResolvedValue({
                audience: "follower",
                libraryVisibility: LibraryVisibility.Followers,
                canViewLibrary: true,
                visibleEntryLevels: [
                    LibraryVisibility.Public,
                    LibraryVisibility.Followers,
                ],
            });

            const response = await request(app.getHttpServer()).get(
                "/profile/user-2",
            );

            expect(response.status).toBe(200);
            expect(response.body).toMatchObject({
                libraryVisibility: LibraryVisibility.Followers,
                canViewLibrary: true,
            });
            expect(libraryAccessService.resolve).toHaveBeenCalledWith(
                "user-1",
                "user-2",
            );
        });

        it("reports a followers library as hidden to a non-follower", async () => {
            profileService.findOneByIdOrFail.mockResolvedValue({
                userId: "user-2",
                username: "them",
                libraryVisibility: LibraryVisibility.Followers,
            });
            libraryAccessService.resolve.mockResolvedValue({
                audience: "everyone",
                libraryVisibility: LibraryVisibility.Followers,
                canViewLibrary: false,
                visibleEntryLevels: [],
            });

            const response = await request(app.getHttpServer()).get(
                "/profile/user-2",
            );

            expect(response.status).toBe(200);
            expect(response.body).toMatchObject({
                libraryVisibility: LibraryVisibility.Followers,
                canViewLibrary: false,
            });
            expect(libraryAccessService.resolve).toHaveBeenCalledWith(
                "user-1",
                "user-2",
            );
        });
    });

    it.each([
        ["png", "image/png", "avatar.png"],
        ["jpeg", "image/jpeg", "avatar.jpg"],
    ])("accepts %s content", async (format, contentType, filename) => {
        const response = await upload(
            await encoded(format as "png" | "jpeg"),
            contentType,
            filename,
        );

        expect(response.status).toBe(200);
        expect(profileService.updateProfileImage).toHaveBeenCalledTimes(1);
    });

    it("rejects real GIF content", async () => {
        const response = await upload(GIF, "image/gif", "avatar.gif");

        expect(response.status).toBe(400);
        expect(profileService.updateProfileImage).not.toHaveBeenCalled();
    });

    it("rejects a GIF renamed and declared as PNG", async () => {
        const response = await upload(GIF, "image/png", "avatar.png");

        expect(response.status).toBe(400);
        expect(profileService.updateProfileImage).not.toHaveBeenCalled();
    });

    it("rejects WebP content", async () => {
        const response = await upload(
            await encoded("webp"),
            "image/webp",
            "avatar.webp",
        );

        expect(response.status).toBe(400);
        expect(profileService.updateProfileImage).not.toHaveBeenCalled();
    });

    it("rejects SVG content", async () => {
        const response = await upload(SVG, "image/svg+xml", "avatar.svg");

        expect(response.status).toBe(400);
        expect(profileService.updateProfileImage).not.toHaveBeenCalled();
    });

    it("rejects undecodable content with 400", async () => {
        const response = await upload(
            Buffer.from("not an image"),
            "image/png",
            "avatar.png",
        );

        expect(response.status).toBe(400);
        expect(profileService.updateProfileImage).not.toHaveBeenCalled();
    });

    it("returns 413 above the upload limit", async () => {
        const response = await upload(
            Buffer.alloc(10_240_001),
            "image/png",
            "avatar.png",
        );

        expect(response.status).toBe(413);
        expect(profileService.updateProfileImage).not.toHaveBeenCalled();
    }, 30_000);
});
