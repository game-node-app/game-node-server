import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { CollectionsController } from "./collections.controller";
import { CollectionsService } from "./collections.service";
import { AuthGuard } from "../auth/auth.guard";
import { CACHE_MANAGER, CacheModule } from "@nestjs/cache-manager";
import { AuthService } from "../auth/auth.service";

describe("CollectionsController", () => {
    let controller: CollectionsController;
    let service: CollectionsService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [CollectionsController],
            providers: [
                { provide: AuthService, useValue: {} },
                {
                    provide: CollectionsService,
                    useValue: {
                        findOneById: jest.fn(),
                        create: jest.fn(),
                        findOneEntryById: jest.fn(),
                        findOneEntryByIgdbId: jest.fn(),
                        createEntry: jest.fn(),
                    },
                },
                {
                    provide: AuthGuard,
                    useValue: jest.fn(),
                },
                {
                    provide: CacheModule,
                    useValue: jest.fn(),
                },
                {
                    provide: CACHE_MANAGER,
                    useValue: CACHE_MANAGER,
                },
            ],
        }).compile();

        controller = module.get<CollectionsController>(CollectionsController);
        service = module.get<CollectionsService>(CollectionsService);
    });

    it("should be defined", () => {
        expect(controller).toBeDefined();
        expect(service).toBeDefined();
    });
});

describe("CollectionsController create failures", () => {
    async function createApp(create: jest.Mock): Promise<INestApplication> {
        const module = await Test.createTestingModule({
            controllers: [CollectionsController],
            providers: [
                { provide: CollectionsService, useValue: { create } },
                {
                    provide: AuthService,
                    useValue: {
                        getSession: jest.fn(async () => ({
                            user: { id: "user-1", role: "user" },
                        })),
                    },
                },
            ],
        }).compile();
        const app = module.createNestApplication();
        await app.init();
        return app;
    }

    it("returns 500 when the entitlement lookup fails at the limit", async () => {
        const create = jest
            .fn()
            .mockRejectedValue(new Error("billing unavailable"));
        const app = await createApp(create);

        try {
            const response = await request(app.getHttpServer())
                .post("/collections")
                .send({ name: "Favorites" });

            expect(response.status).toBe(500);
            expect(create).toHaveBeenCalledTimes(1);
        } finally {
            await app.close();
        }
    });
});
