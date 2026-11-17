import "reflect-metadata";
import { randomUUID } from "node:crypto";
import {
    INestApplication,
    ValidationPipe,
    VersioningType,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { seconds, ThrottlerModule } from "@nestjs/throttler";
import request from "supertest";
import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { AuthService } from "../auth/auth.service";
import { DailyController } from "./daily.controller";
import { DailyService } from "./daily.service";
import { DailyPracticeService } from "./daily-practice.service";
import { DailyPoolService } from "./daily-pool.service";
import { DailyRankingService } from "./daily-ranking.service";
import { DailyScheduler } from "./daily.scheduler";
import { DailyPuzzle } from "./entity/daily-puzzle.entity";
import { DailyResult } from "./entity/daily-result.entity";
import { DailyPracticeRound } from "./entity/daily-practice-round.entity";
import { addDays, dailyToday, DailyMode, DailyStatus } from "./daily.constants";
import { signDailyImageToken } from "./daily-image-token";

// Its own ranges, clear of every other daily suite.
const GAME_ID = 985_000_001;
const WRONG_ID = 985_000_002;
const FIXTURE_NUMBER = 930_000;
const SECRET = "integration-secret";
const ONE_PIXEL_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
);

describe("Daily practice over HTTP (integration)", () => {
    jest.setTimeout(120000);

    let dataSource: DataSource;
    let app: INestApplication;
    let throttledApp: INestApplication;
    let poolService: DailyPoolService;
    let practiceService: DailyPracticeService;
    let dailyService: DailyService;
    let scheduler: DailyScheduler;
    let puzzle: DailyPuzzle;
    let fixtureCount = 0;
    const userIds = new Set<string>();
    const cache = new Map<string, unknown>();

    const auth = {
        getSession: async (req: { headers: { authorization?: string } }) => {
            const userId = req.headers.authorization?.replace("Bearer ", "");
            return userId && userIds.has(userId)
                ? { user: { id: userId, role: "user" } }
                : null;
        },
        getLockoutStates: async () => new Map(),
    };
    const ranking = {
        read: async () => undefined,
        weeklyRanking: async () => undefined,
        weeklyEntry: async () => null,
        summaryAfterPlay: async () => undefined,
        recompute: async () => undefined,
    };

    const rounds = () => dataSource.getRepository(DailyPracticeRound);

    const cleanup = async () => {
        await rounds().delete({ gameId: GAME_ID });
        await dataSource.query(
            "DELETE FROM daily_puzzle WHERE number >= ? AND number < ?",
            [FIXTURE_NUMBER, FIXTURE_NUMBER + 1000],
        );
        if (userIds.size) {
            await dataSource.query(
                `DELETE FROM profile WHERE userId IN (${[...userIds]
                    .map(() => "?")
                    .join(",")})`,
                [...userIds],
            );
            userIds.clear();
        }
        // The fixtures never stay in the pool other daily suites pick from.
        for (const table of [
            "game_cover",
            "game_genres_game_genre",
            "game_platform_games_game",
            "game_involved_companies_game_involved_company",
        ])
            await dataSource.query(
                `DELETE FROM ${table} WHERE gameId IN (?, ?)`,
                [GAME_ID, WRONG_ID],
            );
        await dataSource.query("DELETE FROM game WHERE id IN (?, ?)", [
            GAME_ID,
            WRONG_ID,
        ]);
        await dataSource.query(
            "DELETE FROM game_involved_company WHERE id = ?",
            [GAME_ID],
        );
        await dataSource.query("DELETE FROM game_genre WHERE id = ?", [
            GAME_ID,
        ]);
        await dataSource.query("DELETE FROM game_platform WHERE id = ?", [
            GAME_ID,
        ]);
        await dataSource.query("DELETE FROM game_company WHERE id = ?", [
            GAME_ID,
        ]);
    };

    const createUser = async (label: string) => {
        const userId = randomUUID();
        await dataSource.query(
            "INSERT INTO profile (userId, username) VALUES (?, ?)",
            [userId, `${label.slice(0, 11)}_${userId.slice(0, 8)}`],
        );
        userIds.add(userId);
        return userId;
    };

    /** A game that qualifies for Cover and Specs practice in both pools. */
    const createGameFixture = async () => {
        await dataSource.query(
            "INSERT INTO game (id, name, slug, category, aggregatedRatingCount, firstReleaseDate) VALUES (?, ?, ?, 0, 1000000, '2000-01-01')",
            [GAME_ID, "Practice fixture", `practice-fixture-${GAME_ID}`],
        );
        await dataSource.query(
            "INSERT INTO game_cover (id, gameId, url) VALUES (?, ?, 'fixture')",
            [GAME_ID, GAME_ID],
        );
        await dataSource.query("INSERT INTO game_genre (id) VALUES (?)", [
            GAME_ID,
        ]);
        await dataSource.query(
            "INSERT INTO game_platform (id, name) VALUES (?, 'fixture')",
            [GAME_ID],
        );
        await dataSource.query(
            "INSERT INTO game_company (id, name, slug) VALUES (?, 'fixture', ?)",
            [GAME_ID, `practice-company-${GAME_ID}`],
        );
        await dataSource.query(
            "INSERT INTO game_involved_company (id, companyId, developer, publisher, porting, supporting) VALUES (?, ?, 1, 0, 0, 0)",
            [GAME_ID, GAME_ID],
        );
        await dataSource.query(
            "INSERT INTO game_genres_game_genre VALUES (?, ?)",
            [GAME_ID, GAME_ID],
        );
        await dataSource.query(
            "INSERT INTO game_platform_games_game VALUES (?, ?)",
            [GAME_ID, GAME_ID],
        );
        await dataSource.query(
            "INSERT INTO game_involved_companies_game_involved_company VALUES (?, ?)",
            [GAME_ID, GAME_ID],
        );
        await dataSource.query(
            "INSERT IGNORE INTO game (id, name, slug) VALUES (?, ?, ?)",
            [WRONG_ID, "Practice wrong fixture", `practice-wrong-${WRONG_ID}`],
        );
    };

    const createApp = async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [
                ThrottlerModule.forRoot([{ limit: 100, ttl: seconds(60) }]),
            ],
            controllers: [DailyController],
            providers: [
                { provide: DailyService, useValue: dailyService },
                { provide: DailyPracticeService, useValue: practiceService },
                { provide: DailyPoolService, useValue: poolService },
                { provide: DailyRankingService, useValue: ranking },
                { provide: AuthService, useValue: auth },
            ],
        }).compile();
        const instance = moduleRef.createNestApplication();
        instance.enableVersioning({
            type: VersioningType.URI,
            defaultVersion: "1",
        });
        // Mirrors main.ts.
        instance.useGlobalPipes(
            new ValidationPipe({
                transform: true,
                transformOptions: { enableImplicitConversion: true },
            }),
        );
        await instance.init();
        return instance;
    };

    const startPractice = (
        mode: string,
        userId?: string,
        target: INestApplication = app,
    ) => {
        const req = request(target.getHttpServer()).post("/v1/daily/practice");
        return (
            userId ? req.set("Authorization", `Bearer ${userId}`) : req
        ).send({ mode });
    };

    const playPractice = (
        roundId: string,
        body: object,
        userId?: string,
        target: INestApplication = app,
    ) => {
        const req = request(target.getHttpServer()).post(
            `/v1/daily/practice/${roundId}/play`,
        );
        return (
            userId ? req.set("Authorization", `Bearer ${userId}`) : req
        ).send(body);
    };

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();
        await cleanup();
        await createGameFixture();
        puzzle = await dataSource.getRepository(DailyPuzzle).save({
            kind: "daily",
            mode: DailyMode.COVER,
            number: FIXTURE_NUMBER + ++fixtureCount,
            date: "1972-01-01",
            gameId: GAME_ID,
            meta: {},
            source: "admin" as const,
        });

        const cacheMock = {
            get: async (key: string) => cache.get(key),
            set: async (key: string, value: unknown) => {
                cache.set(key, value);
            },
        };
        poolService = new DailyPoolService(dataSource);
        dailyService = new DailyService(
            dataSource.getRepository(DailyPuzzle),
            dataSource.getRepository(DailyResult),
            dataSource,
            cacheMock as any,
            { getOrThrow: () => SECRET } as any,
            ranking as unknown as DailyRankingService,
        );
        practiceService = new DailyPracticeService(
            rounds(),
            poolService,
            dailyService,
        );
        scheduler = new DailyScheduler(
            dataSource.getRepository(DailyPuzzle),
            poolService,
            rounds(),
            {
                rebuildIfEmpty: async () => undefined,
                snapshotIfNeeded: async () => undefined,
                cleanup: async () => undefined,
            } as unknown as DailyRankingService,
        );
        app = await createApp();
        throttledApp = await createApp();
    });

    beforeEach(() => cache.clear());
    afterEach(() => jest.restoreAllMocks());

    afterAll(async () => {
        if (app) await app.close();
        if (throttledApp) await throttledApp.close();
        if (dataSource?.isInitialized) {
            await cleanup();
            await dataSource.destroy();
        }
    });

    it("starts Cover and Specs rounds without revealing the answer", async () => {
        const cover = await startPractice("cover").expect(201);
        expect(cover.body).toMatchObject({
            mode: DailyMode.COVER,
            maxAttempts: 6,
            attempts: 0,
            status: DailyStatus.IN_PROGRESS,
            feedback: [],
            hintAvailable: false,
            hintAt: null,
        });
        expect(cover.body.roundId).toEqual(expect.any(String));
        expect(cover.body.answer).toBeUndefined();
        expect(cover.body.community).toBeUndefined();
        expect(cover.body.ranking).toBeUndefined();
        expect(cover.body.puzzleId).toBeUndefined();
        expect(cover.body.number).toBeUndefined();
        expect(cover.body.date).toBeUndefined();
        expect(cover.body.hints.imageTokens).toHaveLength(1);

        const specs = await startPractice("specs").expect(201);
        expect(specs.body).toMatchObject({
            mode: DailyMode.SPECS,
            maxAttempts: 10,
            attempts: 0,
            status: DailyStatus.IN_PROGRESS,
        });
        expect(specs.body.answer).toBeUndefined();
        expect(specs.body.hints.imageTokens).toEqual([]);

        // Same feedback as the daily Specs columns.
        const guessed = await playPractice(specs.body.roundId, {
            guesses: [WRONG_ID],
        }).expect(201);
        expect(guessed.body.feedback[0]).toMatchObject({
            gameId: WRONG_ID,
            name: "Practice wrong fixture",
            result: "wrong",
        });
        expect(guessed.body.feedback[0].columns).toBeDefined();
        expect(guessed.body.feedback[0].columns.releaseYear).toBeDefined();
    });

    it("rejects modes without practice", async () => {
        for (const mode of ["artwork", "keywords", "daily"])
            await startPractice(mode).expect(400);
    });

    it("rejects a round started by another account", async () => {
        const owner = await createUser("practice_owner");
        const other = await createUser("practice_other");
        const round = (await startPractice("cover", owner).expect(201)).body;

        await playPractice(round.roundId, { guesses: [] }, other).expect(403);
        await playPractice(round.roundId, { guesses: [] }).expect(403);
        await playPractice(round.roundId, { guesses: [] }, owner).expect(201);
    });

    it("plays a guest round by its id", async () => {
        const round = (await startPractice("cover").expect(201)).body;
        const played = await playPractice(round.roundId, {
            guesses: [WRONG_ID],
        }).expect(201);
        expect(played.body.attempts).toBe(1);
        expect(played.body.status).toBe(DailyStatus.IN_PROGRESS);

        const resumed = await playPractice(round.roundId, {
            guesses: [],
        }).expect(201);
        expect(resumed.body.attempts).toBe(1);
        expect(resumed.body.feedback[0].gameId).toBe(WRONG_ID);
    });

    it("only lets a round's progress grow", async () => {
        const userId = await createUser("practice_grow");
        const round = (await startPractice("cover", userId).expect(201)).body;
        await playPractice(
            round.roundId,
            { guesses: [WRONG_ID] },
            userId,
        ).expect(201);

        // Rewriting the first guess is a change, not a growth.
        await playPractice(
            round.roundId,
            { guesses: [Number(GAME_ID)] },
            userId,
        ).expect(400);
        await playPractice(round.roundId, { guesses: [] }, userId);
        await playPractice(
            round.roundId,
            { guesses: [WRONG_ID, Number(GAME_ID)] },
            userId,
        ).expect(201);
    });

    it("serves images for a round and still serves old puzzle tokens", async () => {
        const round = (await startPractice("cover").expect(201)).body;
        const fetchMock = jest
            .spyOn(globalThis, "fetch")
            .mockImplementation(
                async () => new Response(ONE_PIXEL_PNG, { status: 200 }),
            );

        const roundImage = await request(app.getHttpServer())
            .get(`/v1/daily/images/${round.hints.imageTokens[0]}`)
            .expect(200);
        expect(roundImage.headers["content-type"]).toBe("image/webp");
        expect(roundImage.body.length).toBeGreaterThan(0);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const puzzleToken = signDailyImageToken(
            { p: puzzle.id, k: "cover", l: 0 },
            SECRET,
        );
        await request(app.getHttpServer())
            .get(`/v1/daily/images/${puzzleToken}`)
            .expect(200);
    });

    it("responds 503 without a candidate and creates no round", async () => {
        jest.spyOn(poolService, "pickPractice").mockResolvedValueOnce(null);
        const before = await rounds().count();
        await startPractice("cover").expect(503);
        expect(await rounds().count()).toBe(before);
    });

    it("creates no result and leaves the ranking untouched after a win", async () => {
        const userId = await createUser("practice_win");
        const round = (await startPractice("cover", userId).expect(201)).body;
        const stored = await rounds().findOneByOrFail({
            id: round.roundId,
        });

        const won = await playPractice(
            round.roundId,
            { guesses: [Number(stored.gameId)] },
            userId,
        ).expect(201);
        expect(won.body.status).toBe(DailyStatus.WON);
        expect(won.body.answer.id).toBe(Number(stored.gameId));
        expect(won.body.ranking).toBeUndefined();

        const [{ total }] = await dataSource.query(
            "SELECT COUNT(*) AS total FROM daily_result WHERE userId = ?",
            [userId],
        );
        expect(Number(total)).toBe(0);
        const results = await request(app.getHttpServer())
            .get("/v1/daily/results")
            .set("Authorization", `Bearer ${userId}`)
            .expect(200);
        expect(results.body.data).toEqual([]);
    });

    it("deletes rounds older than 7 days and reads them as 404", async () => {
        const round = (await startPractice("cover").expect(201)).body;
        const token = round.hints.imageTokens[0];
        await dataSource.query(
            "UPDATE daily_practice_round SET createdAt = DATE_SUB(NOW(6), INTERVAL 8 DAY) WHERE id = ?",
            [round.roundId],
        );

        await playPractice(round.roundId, { guesses: [] }).expect(404);
        await request(app.getHttpServer())
            .get(`/v1/daily/images/${token}`)
            .expect(404);

        await scheduler.cleanupPracticeRounds();
        expect(await rounds().findOneBy({ id: round.roundId })).toBeNull();
        await playPractice(round.roundId, { guesses: [] }).expect(404);
    });

    it("deletes the rounds of a deleted profile", async () => {
        const userId = await createUser("practice_cascade");
        const round = (await startPractice("cover", userId).expect(201)).body;

        await dataSource.query("DELETE FROM profile WHERE userId = ?", [
            userId,
        ]);
        userIds.delete(userId);
        expect(await rounds().findOneBy({ id: round.roundId })).toBeNull();
    });

    it("rate limits starts past 30 in a minute", async () => {
        for (let n = 0; n < 30; n++)
            await startPractice("cover", undefined, throttledApp).expect(201);
        await startPractice("cover", undefined, throttledApp).expect(429);
    });
});
