import "reflect-metadata";
import { randomUUID } from "node:crypto";
import {
    INestApplication,
    ValidationPipe,
    VersioningType,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { DataSource } from "typeorm";
import { createAwardsTestDatabase } from "../../test/awards/awards-test-database";
import { RecapController } from "./recap.controller";
import { RecapService } from "./recap.service";
import { RecapWindowService } from "./recap-window.service";
import { RecapGoalsService } from "./recap-goals.service";
import { YearGoal } from "./entity/year-goal.entity";
import { AuthService } from "../auth/auth.service";

describe("Recap yearly goals over HTTP (integration)", () => {
    jest.setTimeout(120000);

    const database = "recap_goals_test";
    const currentYear = new Date().getUTCFullYear();
    const userId = randomUUID();
    const gameId = 9_200_000_000_001;

    let cleanup: () => Promise<void>;
    let dataSource: DataSource;
    let app: INestApplication;
    let entrySequence = 0;

    const server = () => app.getHttpServer();

    const addFinishedEntry = async (year: number) => {
        await dataSource.query(
            `INSERT INTO collection_entry
                (id, gameId, status, libraryUserId, finishedAt, createdAt, updatedAt)
             VALUES (?, ?, 'finished', ?, ?, NOW(6), NOW(6))`,
            [
                randomUUID(),
                gameId,
                userId,
                `${year}-06-${String(++entrySequence).padStart(2, "0")} 00:00:00`,
            ],
        );
    };

    beforeAll(async () => {
        const disposable = await createAwardsTestDatabase(database);
        cleanup = disposable.destroy;
        dataSource = disposable.source;

        await dataSource.query(
            "INSERT INTO game (id, name, slug) VALUES (?, ?, ?)",
            [gameId, "Goals fixture", "goals-fixture"],
        );
        await dataSource.query(
            "INSERT INTO profile (userId, username, createdAt, updatedAt) VALUES (?, ?, NOW(6), NOW(6))",
            [userId, `u_${userId.slice(0, 16)}`],
        );
        await dataSource.query("INSERT INTO library (userId) VALUES (?)", [
            userId,
        ]);

        const moduleRef = await Test.createTestingModule({
            controllers: [RecapController],
            providers: [
                {
                    provide: RecapService,
                    useValue: {
                        getRecapByUserId: jest.fn(async () => ({ year: 2026 })),
                        getRecapStatus: jest.fn(),
                    },
                },
                {
                    provide: RecapWindowService,
                    useValue: {
                        getCurrentRecap: jest.fn(async () => ({
                            year: currentYear,
                            phase: "live",
                            opensAt: new Date(),
                            closesAt: new Date(),
                        })),
                    },
                },
                {
                    provide: RecapGoalsService,
                    useValue: new RecapGoalsService(
                        dataSource.getRepository(YearGoal),
                        dataSource,
                    ),
                },
                {
                    provide: AuthService,
                    useValue: {
                        getSession: async (req: {
                            headers: { authorization?: string };
                        }) =>
                            req.headers.authorization === "Bearer user"
                                ? { user: { id: userId, role: "user" } }
                                : null,
                    },
                },
            ],
        }).compile();

        app = moduleRef.createNestApplication();
        app.enableVersioning({
            type: VersioningType.URI,
            defaultVersion: "1",
        });
        app.useGlobalPipes(
            new ValidationPipe({
                transform: true,
                transformOptions: { enableImplicitConversion: true },
            }),
        );
        await app.init();
    });

    afterAll(async () => {
        if (app) await app.close();
        await cleanup?.();
    });

    it("saves and replaces the current-year goal", async () => {
        const saved = await request(server())
            .put(`/v1/recap/goals/${currentYear}`)
            .set("Authorization", "Bearer user")
            .send({ target: 18 })
            .expect(200);

        expect(saved.body).toEqual({
            year: currentYear,
            target: 18,
            finished: 0,
        });

        const replaced = await request(server())
            .put(`/v1/recap/goals/${currentYear}`)
            .set("Authorization", "Bearer user")
            .send({ target: 22 })
            .expect(200);

        expect(replaced.body.target).toBe(22);

        const read = await request(server())
            .get(`/v1/recap/goals/${currentYear}`)
            .set("Authorization", "Bearer user")
            .expect(200);

        expect(read.body).toEqual({
            year: currentYear,
            target: 22,
            finished: 0,
        });
    });

    it("returns the finished count in the year", async () => {
        for (let index = 0; index < 5; index++) {
            await addFinishedEntry(currentYear);
        }
        await addFinishedEntry(currentYear - 1);

        const read = await request(server())
            .get(`/v1/recap/goals/${currentYear}`)
            .set("Authorization", "Bearer user")
            .expect(200);

        expect(read.body).toEqual({
            year: currentYear,
            target: 22,
            finished: 5,
        });
    });

    it("accepts a goal for the next year and reports a null target without one", async () => {
        const nextYear = currentYear + 1;
        await addFinishedEntry(nextYear);

        const before = await request(server())
            .get(`/v1/recap/goals/${nextYear}`)
            .set("Authorization", "Bearer user")
            .expect(200);

        expect(before.body).toEqual({
            year: nextYear,
            target: null,
            finished: 1,
        });

        const saved = await request(server())
            .put(`/v1/recap/goals/${nextYear}`)
            .set("Authorization", "Bearer user")
            .send({ target: 7 })
            .expect(200);

        expect(saved.body).toEqual({
            year: nextYear,
            target: 7,
            finished: 1,
        });
    });

    it("rejects a past year without storing the goal", async () => {
        await request(server())
            .put(`/v1/recap/goals/${currentYear - 1}`)
            .set("Authorization", "Bearer user")
            .send({ target: 10 })
            .expect(400);

        await expect(
            dataSource.getRepository(YearGoal).findOneBy({
                profileUserId: userId,
                year: currentYear - 1,
            }),
        ).resolves.toBeNull();
    });

    it("rejects targets outside 1 to 999", async () => {
        for (const target of [0, 1000]) {
            await request(server())
                .put(`/v1/recap/goals/${currentYear}`)
                .set("Authorization", "Bearer user")
                .send({ target })
                .expect(400);
        }
    });

    it("requires a session", async () => {
        await request(server())
            .get(`/v1/recap/goals/${currentYear}`)
            .expect(401);

        await request(server())
            .put(`/v1/recap/goals/${currentYear}`)
            .send({ target: 10 })
            .expect(401);
    });

    it("keeps GET /recap/:year/:userId resolving", async () => {
        const response = await request(server())
            .get(`/v1/recap/${currentYear}/user-1`)
            .expect(200);

        expect(response.body).toEqual({ year: 2026 });
    });
});
