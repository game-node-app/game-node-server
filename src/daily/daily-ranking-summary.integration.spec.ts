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
import { BillingService } from "../billing/billing.service";
import { DailyController } from "./daily.controller";
import { DailyService } from "./daily.service";
import { DailyPracticeService } from "./daily-practice.service";
import { DailyRankingService } from "./daily-ranking.service";
import { DailyPuzzle } from "./entity/daily-puzzle.entity";
import { DailyResult } from "./entity/daily-result.entity";
import {
    addDays,
    dailyToday,
    DailyMode,
    DailyPuzzleKind,
    DailyStatus,
    mondayOf,
} from "./daily.constants";

// Its own fixture range: below the ranking spec's 950000, above the controller spec's 900000.
const FIXTURE_NUMBER = 940_000;
const ANSWER_ID = 1;
const WRONG_ID = 940_001;

describe("Daily play ranking summary over HTTP (integration)", () => {
    jest.setTimeout(120000);

    let app: INestApplication;
    let dataSource: DataSource;
    let rankingService: DailyRankingService;
    let fixtureCount = 0;
    const today = dailyToday();
    const userIds = new Set<string>();
    const cache = new Map<string, unknown>();

    const auth = {
        getSession: async (req: { headers: { authorization?: string } }) => {
            const userId = req.headers.authorization?.replace("Bearer ", "");
            return userId && userIds.has(userId)
                ? { user: { id: userId, role: "user" } }
                : null;
        },
        getLockedUserIds: async () => [],
    };
    const billing = { findSupporterUserIds: async () => [] };

    const cleanup = async () => {
        await dataSource.query(
            "DELETE FROM daily_puzzle WHERE number >= ? AND number < ?",
            [FIXTURE_NUMBER, FIXTURE_NUMBER + 10_000],
        );
        if (userIds.size)
            await dataSource.query(
                `DELETE FROM profile WHERE userId IN (${[...userIds]
                    .map(() => "?")
                    .join(",")})`,
                [...userIds],
            );
        userIds.clear();
    };

    const puzzleMemo = new Map<string, Promise<DailyPuzzle>>();
    const findOrCreatePuzzle = async (
        date: string,
        mode: DailyMode,
        kind: DailyPuzzleKind,
    ) => {
        const repository = dataSource.getRepository(DailyPuzzle);
        const existing = await repository.findOneBy({ kind, mode, date });
        if (existing) return existing;
        return repository.save({
            kind,
            mode,
            number: FIXTURE_NUMBER + ++fixtureCount,
            date,
            gameId: ANSWER_ID,
            meta: {},
            source: "admin" as const,
        });
    };
    const puzzle = (
        date: string,
        mode = DailyMode.COVER,
        kind: DailyPuzzleKind = "daily",
    ) => {
        const key = `${kind}:${mode}:${date}`;
        if (!puzzleMemo.has(key))
            puzzleMemo.set(key, findOrCreatePuzzle(date, mode, kind));
        return puzzleMemo.get(key)!;
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

    const seedWin = async (
        userId: string,
        fixture: DailyPuzzle,
        finishedAt = `${fixture.date} 00:00:01`,
    ) =>
        dataSource.query(
            `INSERT INTO daily_result
                 (userId, puzzleId, guesses, hintAt, status, ranked, points, attempts, finishedAt)
             VALUES (?, ?, ?, NULL, ?, 1, 60, 1, ?)`,
            [userId, fixture.id, "[]", DailyStatus.WON, finishedAt],
        );

    const play = (
        userId: string | undefined,
        puzzleId: number,
        body: object,
    ) => {
        const req = request(app.getHttpServer()).post(
            `/v1/daily/puzzles/${puzzleId}/play`,
        );
        return (
            userId ? req.set("Authorization", `Bearer ${userId}`) : req
        ).send(body);
    };

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();
        await cleanup();
        await dataSource.query(
            "INSERT IGNORE INTO game (id, name, slug) VALUES (?, ?, ?)",
            [WRONG_ID, "Daily summary fixture", "daily-summary-fixture"],
        );
        const cacheMock = {
            get: async (key: string) => cache.get(key),
            set: async (key: string, value: unknown) => {
                cache.set(key, value);
            },
        };
        rankingService = new DailyRankingService(
            dataSource,
            auth as unknown as AuthService,
            cacheMock as any,
            billing as unknown as BillingService,
        );
        const dailyService = new DailyService(
            dataSource.getRepository(DailyPuzzle),
            dataSource.getRepository(DailyResult),
            dataSource,
            cacheMock as any,
            { getOrThrow: () => "integration-secret" } as any,
            rankingService,
        );

        const moduleRef = await Test.createTestingModule({
            imports: [
                ThrottlerModule.forRoot([{ limit: 1000, ttl: seconds(60) }]),
            ],
            controllers: [DailyController],
            providers: [
                { provide: DailyService, useValue: dailyService },
                { provide: DailyRankingService, useValue: rankingService },
                { provide: DailyPracticeService, useValue: {} },
                { provide: AuthService, useValue: auth },
            ],
        }).compile();
        app = moduleRef.createNestApplication();
        app.enableVersioning({
            type: VersioningType.URI,
            defaultVersion: "1",
        });
        // Mirrors main.ts.
        app.useGlobalPipes(
            new ValidationPipe({
                transform: true,
                transformOptions: { enableImplicitConversion: true },
            }),
        );
        await app.init();
    });

    beforeEach(() => cache.clear());

    afterAll(async () => {
        if (app) await app.close();
        if (dataSource?.isInitialized) {
            await cleanup();
            await dataSource.destroy();
        }
    });

    it("reports points and the week position after a counted finish", async () => {
        const userId = await createUser("summary_finisher");
        const keywords = await puzzle(today, DailyMode.KEYWORDS);

        const response = await play(userId, keywords.id, {
            guesses: [ANSWER_ID],
        }).expect(201);

        expect(response.body.status).toBe(DailyStatus.WON);
        expect(response.body.ranking).toMatchObject({
            counted: true,
            pointsEarned: 6,
            bonusEarned: 0,
            weekPoints: 6,
            previousWeekPosition: null,
            pointsToTop100: null,
        });
        expect(response.body.ranking.weekPosition).toEqual(expect.any(Number));
    });

    it("adds the bonus on the fourth mode won on the same day", async () => {
        const userId = await createUser("summary_bonus");
        for (const mode of [
            DailyMode.ARTWORK,
            DailyMode.KEYWORDS,
            DailyMode.SPECS,
        ])
            await seedWin(userId, await puzzle(today, mode));

        const response = await play(userId, (await puzzle(today)).id, {
            guesses: [ANSWER_ID],
        }).expect(201);

        expect(response.body.status).toBe(DailyStatus.WON);
        expect(response.body.ranking).toMatchObject({
            counted: true,
            pointsEarned: 6,
            bonusEarned: 2,
            weekPoints: 26,
        });
        expect(response.body.ranking.weekPosition).toBeGreaterThanOrEqual(1);
        expect(response.body.ranking.previousWeekPosition).toEqual(
            expect.any(Number),
        );
    });

    it("reports the bonus of a reopened same-week result from its own day", async () => {
        const userId = await createUser("summary_reopen_week");
        // Yesterday unless today is Monday, when the current week has no earlier day.
        const date = mondayOf(today) === today ? today : addDays(today, -1);
        const modes = Object.values(DailyMode);
        for (const [index, mode] of modes.slice(0, 3).entries())
            await seedWin(
                userId,
                await puzzle(date, mode),
                `${date} 00:00:0${index + 1}`,
            );
        const fourth = await puzzle(date, modes[3]);
        await seedWin(userId, fourth, `${date} 00:00:05`);
        await rankingService.recompute(userId, today);

        const reopened = await play(userId, fourth.id, { guesses: [] }).expect(
            201,
        );

        expect(reopened.body.ranking).toMatchObject({
            counted: true,
            pointsEarned: 6,
            bonusEarned: 2,
            weekPoints: 26,
        });
        expect(reopened.body.ranking.previousWeekPosition).toEqual(
            expect.any(Number),
        );
    });

    it("reports a reopened last-week result without moving this week's position", async () => {
        const userId = await createUser("summary_reopen_last_week");
        await seedWin(userId, await puzzle(today, DailyMode.ARTWORK));
        const lastWeek = addDays(today, -7);
        const modes = Object.values(DailyMode);
        for (const [index, mode] of modes.slice(0, 3).entries())
            await seedWin(
                userId,
                await puzzle(lastWeek, mode),
                `${lastWeek} 00:00:0${index + 1}`,
            );
        const fourth = await puzzle(lastWeek, modes[3]);
        await seedWin(userId, fourth, `${lastWeek} 00:00:05`);
        await rankingService.recompute(userId, today);

        const reopened = await play(userId, fourth.id, { guesses: [] }).expect(
            201,
        );

        expect(reopened.body.ranking).toMatchObject({
            counted: true,
            pointsEarned: 6,
            bonusEarned: 2,
            weekPoints: 6,
        });
        expect(reopened.body.ranking.previousWeekPosition).toBe(
            reopened.body.ranking.weekPosition,
        );
    });

    it("does not count an archive finish and announces zero points", async () => {
        const userId = await createUser("summary_archive");
        const archive = await puzzle("1971-01-01");

        const response = await play(userId, archive.id, {
            guesses: [ANSWER_ID],
        }).expect(201);

        expect(response.body.status).toBe(DailyStatus.WON);
        expect(response.body.ranking).toEqual({
            counted: false,
            pointsEarned: 0,
            weekPoints: 0,
            bonusEarned: 0,
            weekPosition: null,
            previousWeekPosition: null,
            pointsToTop100: null,
        });
    });

    it("reports the same points when a finished puzzle is reopened", async () => {
        const userId = await createUser("summary_reopen");
        const keywords = await puzzle(today, DailyMode.KEYWORDS);
        const first = await play(userId, keywords.id, {
            guesses: [ANSWER_ID],
        }).expect(201);

        const reopened = await play(userId, keywords.id, {
            guesses: [],
        }).expect(201);

        expect(reopened.body.ranking).toEqual(first.body.ranking);
        expect(reopened.body.ranking).toMatchObject({
            counted: true,
            pointsEarned: 6,
            weekPoints: 6,
        });
    });

    it("omits the summary for guests, unfinished plays and weekly puzzles", async () => {
        const guest = await play(undefined, (await puzzle("1971-01-02")).id, {
            guesses: [ANSWER_ID],
        }).expect(201);
        expect(guest.body.ranking).toBeUndefined();

        const unfinishedUser = await createUser("summary_unfinished");
        const unfinished = await play(
            unfinishedUser,
            (await puzzle(today)).id,
            { guesses: [WRONG_ID] },
        ).expect(201);
        expect(unfinished.body.status).toBe(DailyStatus.IN_PROGRESS);
        expect(unfinished.body.ranking).toBeUndefined();

        const weeklyUser = await createUser("summary_weekly");
        const weekly = await puzzle(mondayOf(today), DailyMode.SPECS, "weekly");
        const weeklyResult = await play(weeklyUser, weekly.id, {
            guesses: [ANSWER_ID],
        }).expect(201);
        expect(weeklyResult.body.ranking).toBeUndefined();
    });
});
