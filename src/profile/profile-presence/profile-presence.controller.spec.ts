import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { SUPPORTER_PREFERENCES_DEFAULTS } from "../supporter-preferences/supporter-preferences.defaults";
import { ProfilePresenceController } from "./profile-presence.controller";
import { ProfilePresenceService } from "./profile-presence.service";

describe("ProfilePresenceController", () => {
    let app: INestApplication;
    let service: { getPresence: jest.Mock };

    beforeEach(async () => {
        service = { getPresence: jest.fn(async () => ({ playing: null })) };
        const module = await Test.createTestingModule({
            controllers: [ProfilePresenceController],
            providers: [{ provide: ProfilePresenceService, useValue: service }],
        }).compile();

        app = module.createNestApplication();
        await app.init();
    });

    afterEach(async () => {
        await app.close();
    });

    it("responds without a session", async () => {
        service.getPresence.mockResolvedValue({
            playing: {
                source: "steam",
                name: "Counter-Strike 2",
                gameId: 42,
            },
        });

        const response = await request(app.getHttpServer()).get(
            "/profile/user-2/presence",
        );

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            playing: {
                source: "steam",
                name: "Counter-Strike 2",
                gameId: 42,
            },
        });
    });

    it("returns 200 with playing null for an unknown user", async () => {
        const response = await request(app.getHttpServer()).get(
            "/profile/does-not-exist/presence",
        );

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ playing: null });
        expect(service.getPresence).toHaveBeenCalledWith("does-not-exist");
    });

    it("returns 200 with playing null when Steam fails", async () => {
        const failing = new ProfilePresenceService(
            { isSupporter: jest.fn(async () => true) } as never,
            {
                findOrDefaults: jest.fn(async () => ({
                    ...SUPPORTER_PREFERENCES_DEFAULTS,
                    showLiveProfile: true,
                })),
            } as never,
            {
                findOneByUserIdAndType: jest.fn(async () => ({
                    sourceUserId: "steam-1",
                })),
            } as never,
            {
                getUserSummary: jest.fn(async () => {
                    throw new Error("Steam unavailable");
                }),
            } as never,
            { getExternalGamesForSourceIds: jest.fn() } as never,
            {
                get: jest.fn(async () => undefined),
                set: jest.fn(async () => undefined),
            } as never,
        );
        const module = await Test.createTestingModule({
            controllers: [ProfilePresenceController],
            providers: [{ provide: ProfilePresenceService, useValue: failing }],
        }).compile();
        const isolatedApp = module.createNestApplication();
        await isolatedApp.init();

        try {
            const response = await request(isolatedApp.getHttpServer()).get(
                "/profile/user-2/presence",
            );

            expect(response.status).toBe(200);
            expect(response.body).toEqual({ playing: null });
        } finally {
            await isolatedApp.close();
        }
    });
});
