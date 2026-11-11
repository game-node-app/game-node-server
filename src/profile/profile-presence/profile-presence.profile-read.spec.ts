import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AuthService } from "../../auth/auth.service";
import { ConnectionsService } from "../../connection/connections.service";
import { SteamSyncService } from "../../sync/steam/steam-sync.service";
import { ProfileController } from "../profile.controller";
import { ProfileService } from "../profile.service";
import { ProfileVideoService } from "../profile-video/profile-video.service";
import { SUPPORTER_PREFERENCES_DEFAULTS } from "../supporter-preferences/supporter-preferences.defaults";
import { SupporterPreferencesService } from "../supporter-preferences/supporter-preferences.service";

describe("Profile reads and Steam", () => {
    let app: INestApplication;
    let profileService: { findOneByIdOrFail: jest.Mock };
    let videoService: { isSupporter: jest.Mock; findForProfileRead: jest.Mock };
    let preferences: { findOrDefaults: jest.Mock };
    let steam: { getUserSummary: jest.Mock };
    let connections: { findOneByUserIdAndType: jest.Mock };

    beforeEach(async () => {
        profileService = {
            findOneByIdOrFail: jest.fn(async () => ({
                userId: "user-2",
                username: "them",
            })),
        };
        videoService = {
            isSupporter: jest.fn(async () => true),
            findForProfileRead: jest.fn(async () => ({
                avatarVideo: null,
                bannerVideo: null,
            })),
        };
        preferences = {
            findOrDefaults: jest.fn(async () => ({
                ...SUPPORTER_PREFERENCES_DEFAULTS,
                showLiveProfile: true,
            })),
        };
        steam = { getUserSummary: jest.fn() };
        connections = { findOneByUserIdAndType: jest.fn() };

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
                    useValue: preferences,
                },
                { provide: SteamSyncService, useValue: steam },
                { provide: ConnectionsService, useValue: connections },
            ],
        }).compile();

        app = module.createNestApplication();
        await app.init();
    });

    afterEach(async () => {
        await app.close();
    });

    // 5.2: presence is a separate endpoint; a profile read must never reach Steam.
    it("never contacts Steam for an opted-in supporter", async () => {
        const response = await request(app.getHttpServer()).get(
            "/profile/user-2",
        );

        expect(response.status).toBe(200);
        expect(response.body.isSupporter).toBe(true);
        expect(response.body.supporterPreferences.showLiveProfile).toBe(true);
        expect(steam.getUserSummary).not.toHaveBeenCalled();
        expect(connections.findOneByUserIdAndType).not.toHaveBeenCalled();
    });
});
