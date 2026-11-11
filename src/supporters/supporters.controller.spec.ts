import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import request from "supertest";
import { FindManyOptions } from "typeorm";
import { AuthService, LockoutState } from "../auth/auth.service";
import { BillingService } from "../billing/billing.service";
import { Profile } from "../profile/entities/profile.entity";
import { SupporterPreferencesService } from "../profile/supporter-preferences/supporter-preferences.service";
import { SupporterWallItemDto } from "./dto/supporters-wall.dto";
import { SupportersController } from "./supporters.controller";
import { SupportersService } from "./supporters.service";

describe("SupportersController", () => {
    let app: INestApplication;
    let profiles: Map<string, Profile>;
    let supporterIds: string[];
    let lockouts: Map<string, LockoutState>;
    let hiddenIds: string[];
    let repository: { find: jest.Mock };
    let billing: { findSupporterUserIds: jest.Mock };
    let auth: { getLockoutStates: jest.Mock };
    let preferences: { findWallHiddenUserIds: jest.Mock };

    function addProfiles(count: number) {
        for (let index = 1; index <= count; index++) {
            const id = `user-${String(index).padStart(2, "0")}`;
            profiles.set(id, {
                userId: id,
                username: id,
                avatar: null,
            } as Profile);
            supporterIds.push(id);
        }
    }

    beforeEach(async () => {
        profiles = new Map();
        supporterIds = [];
        lockouts = new Map();
        hiddenIds = [];
        repository = {
            find: jest.fn(async (options: FindManyOptions<Profile>) => {
                const ids = (
                    options.where as unknown as {
                        userId: { value: string | string[] };
                    }
                ).userId.value;
                const idList = Array.isArray(ids) ? ids : [ids];
                return idList
                    .map((id) => profiles.get(id))
                    .filter((profile): profile is Profile => !!profile)
                    .sort((a, b) => a.username.localeCompare(b.username));
            }),
        };
        billing = { findSupporterUserIds: jest.fn(async () => supporterIds) };
        auth = { getLockoutStates: jest.fn(async () => lockouts) };
        preferences = {
            findWallHiddenUserIds: jest.fn(async () => hiddenIds),
        };
        const cache = new Map<string, SupporterWallItemDto[]>();
        const cacheManager = {
            get: jest.fn(async (key: string) => cache.get(key)),
            set: jest.fn(
                async (key: string, value: SupporterWallItemDto[]) =>
                    void cache.set(key, value),
            ),
            del: jest.fn(async (key: string) => void cache.delete(key)),
        };

        const moduleRef = await Test.createTestingModule({
            controllers: [SupportersController],
            providers: [
                SupportersService,
                {
                    provide: getRepositoryToken(Profile),
                    useValue: repository,
                },
                { provide: BillingService, useValue: billing },
                { provide: AuthService, useValue: auth },
                {
                    provide: SupporterPreferencesService,
                    useValue: preferences,
                },
                { provide: CACHE_MANAGER, useValue: cacheManager },
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

    function get(query: Record<string, unknown> = {}) {
        return request(app.getHttpServer()).get("/supporters").query(query);
    }

    it("serves the wall without a session and exposes no billing data", async () => {
        addProfiles(2);
        hiddenIds.push("user-02");

        const response = await get();

        expect(response.status).toBe(200);
        expect(response.body.pagination.totalItems).toBe(1);
        expect(response.body.data).toEqual([
            { userId: "user-01", username: "user-01", avatar: null },
        ]);
        expect(Object.keys(response.body.data[0]).sort()).toEqual([
            "avatar",
            "userId",
            "username",
        ]);
    });

    it("returns 400 for a limit above 100", async () => {
        addProfiles(2);

        const response = await get({ limit: 101 });

        expect(response.status).toBe(400);
        expect(billing.findSupporterUserIds).not.toHaveBeenCalled();
    });

    it("returns the requested page with the total number of supporters", async () => {
        addProfiles(25);

        const response = await get({ offset: 20, limit: 20 });

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(5);
        expect(response.body.data[0].userId).toBe("user-21");
        expect(response.body.pagination).toEqual({
            totalItems: 25,
            totalPages: 2,
            hasNextPage: false,
        });
    });

    it("defaults to a limit of 20", async () => {
        addProfiles(25);

        const response = await get();

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(20);
        expect(response.body.pagination).toEqual({
            totalItems: 25,
            totalPages: 2,
            hasNextPage: true,
        });
    });

    it("responds 200 with an empty list when Stripe is not configured", async () => {
        const response = await get();

        expect(response.status).toBe(200);
        expect(response.body.data).toEqual([]);
        expect(response.body.pagination.totalItems).toBe(0);
    });

    it("does not query again on a cache hit", async () => {
        addProfiles(3);
        await get();

        jest.clearAllMocks();
        const response = await get();

        expect(response.status).toBe(200);
        expect(response.body.pagination.totalItems).toBe(3);
        expect(billing.findSupporterUserIds).not.toHaveBeenCalled();
        expect(auth.getLockoutStates).not.toHaveBeenCalled();
        expect(preferences.findWallHiddenUserIds).not.toHaveBeenCalled();
        expect(repository.find).not.toHaveBeenCalled();
    });
});
