import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import request from "supertest";
import { AuthService } from "../../auth/auth.service";
import { BillingService } from "../../billing/billing.service";
import { SupporterGuard } from "../../billing/supporter.guard";
import { ProfileSupporterPreferences } from "../entities/profile-supporter-preferences.entity";
import { SUPPORTER_PREFERENCES_DEFAULTS } from "./supporter-preferences.defaults";
import {
    profilePresenceCacheKey,
    SUPPORTERS_WALL_CACHE_KEY,
} from "./supporter-preferences.cache";
import { SupporterPreferencesController } from "./supporter-preferences.controller";
import { SupporterPreferencesService } from "./supporter-preferences.service";

describe("SupporterPreferencesController", () => {
    let app: INestApplication;
    let stored: ProfileSupporterPreferences | null;
    let repository: {
        findOneBy: jest.Mock;
        upsert: jest.Mock;
        find: jest.Mock;
    };
    let cache: { del: jest.Mock };
    let auth: { getSession: jest.Mock };
    let billing: { isSupporter: jest.Mock };

    beforeEach(async () => {
        stored = null;
        repository = {
            findOneBy: jest.fn(async () => stored),
            upsert: jest.fn(
                async (values: Partial<ProfileSupporterPreferences>) => {
                    stored = {
                        ...SUPPORTER_PREFERENCES_DEFAULTS,
                        ...stored,
                        ...values,
                    } as ProfileSupporterPreferences;
                },
            ),
            find: jest.fn(),
        };
        cache = { del: jest.fn(async () => true) };
        auth = {
            getSession: jest.fn(async () => ({
                user: { id: "user-1", role: "user" },
            })),
        };
        billing = { isSupporter: jest.fn(async () => true) };

        const moduleRef = await Test.createTestingModule({
            controllers: [SupporterPreferencesController],
            providers: [
                SupporterPreferencesService,
                SupporterGuard,
                {
                    provide: getRepositoryToken(ProfileSupporterPreferences),
                    useValue: repository,
                },
                { provide: AuthService, useValue: auth },
                { provide: BillingService, useValue: billing },
                { provide: CACHE_MANAGER, useValue: cache },
            ],
        }).compile();

        app = moduleRef.createNestApplication();
        // Mirrors main.ts.
        app.useGlobalPipes(
            new ValidationPipe({
                transform: true,
                transformOptions: { enableImplicitConversion: true },
            }),
        );
        await app.init();
    });

    afterEach(async () => {
        await app.close();
    });

    function patch(body: Record<string, unknown>) {
        return request(app.getHttpServer())
            .patch("/profile/supporter-preferences")
            .send(body);
    }

    it("returns 200 with the complete preferences for a partial update", async () => {
        const response = await patch({ showBadge: false });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            ...SUPPORTER_PREFERENCES_DEFAULTS,
            showBadge: false,
        });
        expect(repository.upsert).toHaveBeenCalledWith(
            { profileUserId: "user-1", showBadge: false },
            ["profileUserId"],
        );
    });

    it("preserves the other stored fields on a partial update", async () => {
        await patch({ titleKey: "founder", accentColor: "#FF8800" });

        const response = await patch({ showSupporterTheme: false });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            ...SUPPORTER_PREFERENCES_DEFAULTS,
            titleKey: "founder",
            accentColor: "#FF8800",
            showSupporterTheme: false,
        });
    });

    it.each([
        { accentColor: "red" },
        { titleKey: "GameNode Admin" },
        { showBadge: null },
        { showLiveProfile: "true" },
    ])("returns 400 and stores nothing for %o", async (body) => {
        const response = await patch(body);

        expect(response.status).toBe(400);
        expect(repository.upsert).not.toHaveBeenCalled();
    });

    it("returns 401 without a session", async () => {
        auth.getSession.mockResolvedValue(null);

        const response = await patch({ showBadge: false });

        expect(response.status).toBe(401);
        expect(repository.upsert).not.toHaveBeenCalled();
    });

    it("returns 403 for a non-supporter", async () => {
        billing.isSupporter.mockResolvedValue(false);

        const response = await patch({ showBadge: false });

        expect(response.status).toBe(403);
        expect(repository.upsert).not.toHaveBeenCalled();
    });

    it("returns the current state without writing for an empty body", async () => {
        const response = await patch({});

        expect(response.status).toBe(200);
        expect(response.body).toEqual(SUPPORTER_PREFERENCES_DEFAULTS);
        expect(repository.upsert).not.toHaveBeenCalled();
        expect(cache.del).not.toHaveBeenCalled();
    });

    it("deletes both cache keys after a save", async () => {
        await patch({ showBadge: false });

        expect(cache.del).toHaveBeenCalledWith(SUPPORTERS_WALL_CACHE_KEY);
        expect(cache.del).toHaveBeenCalledWith(
            profilePresenceCacheKey("user-1"),
        );
    });

    it("succeeds when cache invalidation fails", async () => {
        cache.del.mockRejectedValue(new Error("redis down"));

        const response = await patch({ showBadge: false });

        expect(response.status).toBe(200);
        expect(response.body.showBadge).toBe(false);
    });

    it("returns null-cleared fields", async () => {
        await patch({ titleKey: "founder", accentColor: "#FF8800" });

        const response = await patch({ titleKey: null, accentColor: null });

        expect(response.status).toBe(200);
        expect(response.body.titleKey).toBeNull();
        expect(response.body.accentColor).toBeNull();
    });
});
