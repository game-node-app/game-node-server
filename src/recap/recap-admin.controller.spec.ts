import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import request from "supertest";
import { DataSource } from "typeorm";
import { AuthService } from "../auth/auth.service";
import { YearRecapEdition } from "./entity/year-recap-edition.entity";
import { RecapAdminController } from "./recap-admin.controller";
import { RecapController } from "./recap.controller";
import { RecapService } from "./recap.service";
import { RecapWindowService } from "./recap-window.service";
import { RecapGoalsService } from "./recap-goals.service";

describe("Recap HTTP reads and admin edition", () => {
    let app: INestApplication;
    let windowService: RecapWindowService;
    const editionRepository = {
        findOne: jest.fn(async () => null),
        upsert: jest.fn(async () => undefined),
    };
    const queryResultCache = { remove: jest.fn(async () => undefined) };
    const recapService = {
        getRecapStatus: jest.fn(async () => ({
            isRecapCreated: true,
            isRecapEligible: true,
            phase: "live",
        })),
        getRecapByUserId: jest.fn(async () => ({ year: 2026 })),
    };
    const sessions = new Map<string, unknown>();
    const authService = {
        getSession: jest.fn(
            async (req: { headers: Record<string, string> }) => {
                const session = sessions.get(req.headers.authorization);
                return session ?? null;
            },
        ),
    };

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            controllers: [RecapController, RecapAdminController],
            providers: [
                RecapWindowService,
                {
                    provide: getRepositoryToken(YearRecapEdition),
                    useValue: editionRepository,
                },
                {
                    provide: DataSource,
                    useValue: { queryResultCache },
                },
                { provide: RecapService, useValue: recapService },
                {
                    provide: RecapGoalsService,
                    useValue: {
                        getGoal: jest.fn(),
                        setGoal: jest.fn(),
                    },
                },
                { provide: AuthService, useValue: authService },
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

        windowService = moduleRef.get(RecapWindowService);
        jest.spyOn(windowService, "getCurrentRecap").mockResolvedValue({
            year: 2026,
            phase: "live",
            opensAt: new Date("2026-11-15T00:00:00.000Z"),
            closesAt: new Date("2026-12-31T23:59:59.999Z"),
        });

        sessions.set("admin", { user: { id: "admin", role: "admin" } });
        sessions.set("user", { user: { id: "user", role: "user" } });
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterAll(async () => {
        await app.close();
    });

    it("serves the current Recap window without a session", async () => {
        const response = await request(app.getHttpServer()).get(
            "/recap/current",
        );

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            year: 2026,
            phase: "live",
            opensAt: "2026-11-15T00:00:00.000Z",
            closesAt: "2026-12-31T23:59:59.999Z",
        });
    });

    it("rejects an unauthenticated edition update", async () => {
        const response = await request(app.getHttpServer())
            .put("/recap/admin/editions/2026")
            .send({ opensAt: "2026-12-01T00:00:00.000Z" });

        expect(response.status).toBe(401);
    });

    it("rejects a non-admin edition update", async () => {
        const response = await request(app.getHttpServer())
            .put("/recap/admin/editions/2026")
            .set("Authorization", "user")
            .send({ opensAt: "2026-12-01T00:00:00.000Z" });

        expect(response.status).toBe(403);
        expect(editionRepository.upsert).not.toHaveBeenCalled();
    });

    it("rejects an opening outside the year", async () => {
        const response = await request(app.getHttpServer())
            .put("/recap/admin/editions/2026")
            .set("Authorization", "admin")
            .send({ opensAt: "2027-01-05T00:00:00.000Z" });

        expect(response.status).toBe(400);
        expect(editionRepository.upsert).not.toHaveBeenCalled();
        expect(queryResultCache.remove).not.toHaveBeenCalled();
    });

    it("stores the opening and clears the cache for an admin", async () => {
        const response = await request(app.getHttpServer())
            .put("/recap/admin/editions/2026")
            .set("Authorization", "admin")
            .send({ opensAt: "2026-12-01T00:00:00.000Z" });

        expect(response.status).toBe(200);
        expect(editionRepository.upsert).toHaveBeenCalledWith(
            {
                year: 2026,
                opensAt: new Date("2026-12-01T00:00:00.000Z"),
            },
            ["year"],
        );
        expect(queryResultCache.remove).toHaveBeenCalledWith([
            "recap_edition_2026",
        ]);
    });

    it("keeps the status route resolving with its phase", async () => {
        const response = await request(app.getHttpServer()).get(
            "/recap/2026/user-1/status",
        );

        expect(response.status).toBe(200);
        expect(response.body.phase).toBe("live");
        expect(recapService.getRecapStatus).toHaveBeenCalledWith(
            "user-1",
            2026,
        );
    });

    it("keeps the recap read route resolving", async () => {
        const response = await request(app.getHttpServer()).get(
            "/recap/2026/user-1",
        );

        expect(response.status).toBe(200);
        expect(recapService.getRecapByUserId).toHaveBeenCalledWith(
            "user-1",
            2026,
        );
    });
});
