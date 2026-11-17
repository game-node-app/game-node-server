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
    dailyNextResetAt,
    dailyToday,
    DailyMode,
    DailyPuzzleKind,
    DailyStatus,
    mondayOf,
} from "./daily.constants";

// Fixture numbers use their own range, below the ranking spec's 950000.
const FIXTURE_NUMBER = 920_000;
const ANSWER_ID = 1;
const WRONG_ID = 920_001;

describe("Daily ranking and weekly challenge over HTTP (integration)", () => {
    jest.setTimeout(120000);

    let app: INestApplication;
    let dataSource: DataSource;
    let dailyService: DailyService;
    let rankingService: DailyRankingService;
    let fixtureCount = 0;
    const today = dailyToday();
    const userIds = new Set<string>();
    const cache = new Map<string, unknown>();
    let supporterIds: string[] = [];
    let bannedIds = new Set<string>();

    const auth = {
        getSession: async (req: { headers: { authorization?: string } }) => {
            const userId = req.headers.authorization?.replace("Bearer ", "");
            return userId && userIds.has(userId)
                ? { user: { id: userId, role: "user" } }
                : null;
        },
        getLockedUserIds: async () => [...bannedIds],
    };

    const billing = {
        findSupporterUserIds: async () => supporterIds,
    };

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
    // One puzzle per kind/mode/date: sharing keeps suites from colliding on the unique key.
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

    const addResult = (
        userId: string,
        fixture: DailyPuzzle,
        {
            status = DailyStatus.WON,
            points = 0,
            attempts = 1,
            ranked = 1,
            finishedAt,
        }: {
            status?: DailyStatus;
            points?: number;
            attempts?: number;
            ranked?: number;
            finishedAt?: string | null;
        } = {},
    ) =>
        dataSource.query(
            `INSERT INTO daily_result
                 (userId, puzzleId, guesses, hintAt, status, ranked, points, attempts, finishedAt)
             VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
            [
                userId,
                fixture.id,
                "[]",
                status,
                ranked,
                points,
                attempts,
                finishedAt === undefined
                    ? `${fixture.date} 12:00:00`
                    : finishedAt,
            ],
        );

    const follow = (follower: string, followed: string) =>
        dataSource.query(
            "INSERT INTO user_follow (followerUserId, followedUserId, createdAt, updatedAt) VALUES (?, ?, NOW(), NOW())",
            [follower, followed],
        );

    const hideBadge = (userId: string) =>
        dataSource.query(
            "INSERT INTO profile_supporter_preferences (profileUserId, showBadge) VALUES (?, 0)",
            [userId],
        );

    const get = (path: string, userId?: string) => {
        const req = request(app.getHttpServer()).get(path);
        return userId ? req.set("Authorization", `Bearer ${userId}`) : req;
    };
    const post = (path: string, userId?: string, body: object = {}) => {
        const req = request(app.getHttpServer()).post(path);
        return (
            userId ? req.set("Authorization", `Bearer ${userId}`) : req
        ).send(body);
    };

    const ranking = async (
        query: Record<string, string | number>,
        userId?: string,
    ) => {
        const expected = await get("/v1/daily/ranking", userId).query(query);
        expect(expected.status).toBe(200);
        return expected.body;
    };

    const recompute = async (date: string, ...ids: string[]) => {
        for (const id of ids) await rankingService.recompute(id, date);
    };

    const inPeriod = (date: string, period: string) => {
        if (period === "today") return date === today;
        if (period === "week") return date >= mondayOf(today) && date <= today;
        if (period === "month") return date.slice(0, 7) === today.slice(0, 7);
        return true;
    };

    const monthEnd = (date: string) => {
        const [year, month] = date.split("-").map(Number);
        const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
        return `${date.slice(0, 8)}${String(last).padStart(2, "0")}`;
    };

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();
        await cleanup();
        await dataSource.query(
            "INSERT IGNORE INTO game (id, name, slug) VALUES (?, ?, ?)",
            [WRONG_ID, "Daily ranking fixture", `daily-ranking-fixture`],
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
        dailyService = new DailyService(
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

    beforeEach(() => {
        cache.clear();
        supporterIds = [];
        bannedIds = new Set();
    });

    afterAll(async () => {
        if (app) await app.close();
        if (dataSource?.isInitialized) {
            await cleanup();
            await dataSource.destroy();
        }
    });

    describe("GET /daily/ranking", () => {
        it("includes only puzzles inside each period and reports the period end", async () => {
            const userId = await createUser("periods");
            const rows: [string, number][] = [
                [today, 10],
                [addDays(today, -1), 20],
                [addDays(today, -10), 30],
            ];
            for (const [date, points] of rows)
                await addResult(userId, await puzzle(date), { points });
            await recompute(today, userId);

            for (const period of ["today", "week", "month", "all"]) {
                const body = await ranking(
                    { period, mode: "cover", limit: 100 },
                    userId,
                );
                const expected =
                    rows
                        .filter(([date]) => inPeriod(date, period))
                        .reduce((total, [, points]) => total + points, 0) / 10;
                expect(body.period).toBe(period);
                expect(body.mode).toBe("cover");
                expect(body.totalPlayers).toBeGreaterThanOrEqual(1);
                expect(body.viewer).toMatchObject({
                    userId,
                    points: expected,
                });
                expect(body.endsAt).toBe(
                    period === "all"
                        ? null
                        : dailyNextResetAt(
                              period === "today"
                                  ? today
                                  : period === "week"
                                    ? addDays(mondayOf(today), 6)
                                    : monthEnd(today),
                          ),
                );
            }
        });

        it("builds overall and mode rows with the documented fields", async () => {
            const userId = await createUser("rows");
            await addResult(userId, await puzzle(today, DailyMode.KEYWORDS), {
                points: 30,
                attempts: 3,
            });
            await addResult(
                userId,
                await puzzle(addDays(today, -1), DailyMode.KEYWORDS),
                { status: DailyStatus.LOST, attempts: 6 },
            );
            await recompute(today, userId);

            const modeRow = await ranking(
                { period: "all", mode: "keywords", limit: 100 },
                userId,
            );
            expect(modeRow.viewer).toMatchObject({
                points: 3,
                winRate: 50,
                wins: 1,
                averageAttempts: 3,
                bestStreak: 1,
            });
            expect(modeRow.viewer.modePoints).toBeUndefined();
            expect(modeRow.viewer.currentStreak).toBeUndefined();

            const overall = await ranking(
                { period: "all", limit: 100 },
                userId,
            );
            expect(overall.viewer.modePoints).toEqual({
                cover: 0,
                artwork: 0,
                keywords: 3,
                specs: 0,
            });
            expect(overall.viewer.currentStreak).toBe(1);
            expect(overall.viewer.wins).toBeUndefined();
        });

        it("keeps a streak alive until yesterday and reports 0 when it is broken", async () => {
            const alive = await createUser("streak_alive");
            for (const offset of [0, -1, -2])
                await addResult(alive, await puzzle(addDays(today, offset)), {
                    points: 10,
                });
            const broken = await createUser("streak_broken");
            for (const offset of [-2, -3])
                await addResult(broken, await puzzle(addDays(today, offset)), {
                    points: 10,
                });
            await recompute(today, alive, broken);

            const aliveRow = await ranking(
                { period: "all", limit: 100 },
                alive,
            );
            expect(aliveRow.viewer).toMatchObject({
                currentStreak: 3,
                points: 3,
            });
            const aliveModeRow = await ranking(
                { period: "all", mode: "cover", limit: 100 },
                alive,
            );
            expect(aliveModeRow.viewer.bestStreak).toBe(3);

            const brokenRow = await ranking(
                { period: "all", limit: 100 },
                broken,
            );
            // Broken current streak, but the best run stays in the mode view.
            expect(brokenRow.viewer.currentStreak).toBe(0);
            const brokenModeRow = await ranking(
                { period: "all", mode: "cover", limit: 100 },
                broken,
            );
            expect(brokenModeRow.viewer.bestStreak).toBe(2);
        });

        it("reports positions moved since yesterday and new players", async () => {
            const up = await createUser("moved");
            const steady = await createUser("steady");
            const fresh = await createUser("new");
            const yesterday = addDays(today, -1);
            await addResult(up, await puzzle(yesterday, DailyMode.ARTWORK), {
                points: 10,
            });
            await addResult(
                steady,
                await puzzle(yesterday, DailyMode.ARTWORK),
                { points: 20 },
            );
            await addResult(up, await puzzle(today, DailyMode.ARTWORK), {
                points: 40,
            });
            await addResult(fresh, await puzzle(today, DailyMode.ARTWORK), {
                points: 5,
            });
            await recompute(today, up, steady, fresh);

            // Before the day's snapshot there is no previous list.
            const beforeSnapshot = await ranking(
                { period: "all", mode: "artwork", limit: 100 },
                up,
            );
            expect(beforeSnapshot.viewer.positionChange).toBeNull();
            await rankingService.snapshot(today);

            const body = await ranking(
                { period: "all", mode: "artwork", limit: 100 },
                up,
            );
            const byId = new Map(
                body.data.map((row: { userId: string }) => [row.userId, row]),
            );
            expect(byId.get(up)).toMatchObject({
                position: 1,
                positionChange: 1,
                points: 5,
            });
            expect(byId.get(steady)).toMatchObject({
                position: 2,
                positionChange: -1,
            });
            expect(byId.get(fresh)).toMatchObject({
                position: 3,
                positionChange: "new",
            });

            // Today's ranking has no previous list.
            expect(body.viewer.positionChange).not.toBeNull();
            const todayBody = await ranking(
                { period: "today", mode: "artwork", limit: 100 },
                up,
            );
            expect(todayBody.viewer.positionChange).toBeNull();
        });

        it("computes position changes only against the current period so far", async () => {
            const monday = "2026-03-02";
            const firstOfMonth = "2026-04-01";
            const wednesday = "2026-03-11";
            const [mondayA, mondayB, firstA, firstB, moved, steady] =
                await Promise.all([
                    createUser("baseline_mon_a"),
                    createUser("baseline_mon_b"),
                    createUser("baseline_first_a"),
                    createUser("baseline_first_b"),
                    createUser("baseline_moved"),
                    createUser("baseline_steady"),
                ]);
            // Played last week and again on Monday: the old baseline would pair them with a number.
            await addResult(mondayA, await puzzle("2026-02-23"), {
                points: 10,
            });
            await addResult(mondayA, await puzzle(monday), { points: 10 });
            await addResult(mondayB, await puzzle(monday), { points: 20 });
            // Played last month and again on the 1st.
            await addResult(firstA, await puzzle("2026-03-15"), { points: 10 });
            await addResult(firstA, await puzzle(firstOfMonth), { points: 10 });
            await addResult(firstB, await puzzle(firstOfMonth), { points: 20 });
            // Wednesday: Monday's results form the baseline, today's move the pair.
            await addResult(moved, await puzzle("2026-03-09"), { points: 10 });
            await addResult(steady, await puzzle("2026-03-09"), { points: 30 });
            await addResult(moved, await puzzle(wednesday), { points: 40 });
            await recompute(
                monday,
                mondayA,
                mondayB,
                firstA,
                firstB,
                moved,
                steady,
            );
            await rankingService.snapshot(monday);

            const onMonday = await rankingService.read(
                "week",
                undefined,
                "all",
                0,
                100,
                undefined,
                monday,
            );
            expect(onMonday.data).toHaveLength(2);
            expect(
                onMonday.data.map(
                    (row: { positionChange: unknown }) => row.positionChange,
                ),
            ).toEqual(["new", "new"]);

            await recompute(
                firstOfMonth,
                mondayA,
                mondayB,
                firstA,
                firstB,
                moved,
                steady,
            );
            await rankingService.snapshot(firstOfMonth);
            const onFirst = await rankingService.read(
                "month",
                undefined,
                "all",
                0,
                100,
                undefined,
                firstOfMonth,
            );
            expect(onFirst.data).toHaveLength(2);
            expect(
                onFirst.data.map(
                    (row: { positionChange: unknown }) => row.positionChange,
                ),
            ).toEqual(["new", "new"]);

            await recompute(
                wednesday,
                mondayA,
                mondayB,
                firstA,
                firstB,
                moved,
                steady,
            );
            await rankingService.snapshot(wednesday);
            const onWednesday = await rankingService.read(
                "week",
                undefined,
                "all",
                0,
                100,
                undefined,
                wednesday,
            );
            const byId = new Map(
                onWednesday.data.map((row) => [row.userId, row]),
            );
            expect(byId.get(moved)).toMatchObject({
                position: 1,
                positionChange: 1,
                points: 5,
            });
            expect(byId.get(steady)).toMatchObject({
                position: 2,
                positionChange: -1,
                points: 3,
            });
        });

        it("never gives a banned player a previous position", async () => {
            const stayed = await createUser("prev_ban_steady");
            const moved = await createUser("prev_ban_moved");
            const banned = await createUser("prev_ban_banned");
            const yesterday = addDays(today, -1);
            const artwork = (date: string) => puzzle(date, DailyMode.ARTWORK);
            // Yesterday the banned player was first; dropping it leaves stayed then moved.
            await addResult(banned, await artwork(yesterday), {
                points: 10_000,
            });
            await addResult(stayed, await artwork(yesterday), {
                points: 5_000,
            });
            await addResult(moved, await artwork(yesterday), { points: 3_000 });
            await addResult(moved, await artwork(today), { points: 400 });
            await recompute(today, banned, stayed, moved);
            await rankingService.snapshot(today);
            bannedIds.add(banned);

            const body = await ranking(
                { period: "all", mode: "artwork", limit: 100 },
                moved,
            );
            const byId = new Map(
                body.data.map((row: { userId: string }) => [row.userId, row]),
            );
            expect(byId.has(banned)).toBe(false);
            expect(byId.get(stayed)).toMatchObject({
                position: 1,
                positionChange: 0,
            });
            expect(byId.get(moved)).toMatchObject({
                position: 2,
                positionChange: 0,
            });
        });

        it("orders ties by attempts, last finish and user id in SQL", async () => {
            const [many, few, late, early, idA, idB] = await Promise.all([
                createUser("tie_many"),
                createUser("tie_few"),
                createUser("tie_late"),
                createUser("tie_early"),
                createUser("tie_id_a"),
                createUser("tie_id_b"),
            ]);
            const cover = await puzzle(today);
            await addResult(many, cover, { points: 50, attempts: 3 });
            await addResult(few, cover, { points: 50, attempts: 1 });
            await addResult(late, cover, {
                points: 40,
                attempts: 1,
                finishedAt: `${today} 10:00:00`,
            });
            await addResult(early, cover, {
                points: 40,
                attempts: 1,
                finishedAt: `${today} 09:00:00`,
            });
            await addResult(idA, cover, {
                points: 30,
                attempts: 1,
                finishedAt: `${today} 08:00:00`,
            });
            await addResult(idB, cover, {
                points: 30,
                attempts: 1,
                finishedAt: `${today} 08:00:00`,
            });
            await recompute(today, many, few, late, early, idA, idB);

            const body = await ranking({
                period: "today",
                mode: "cover",
                limit: 100,
            });
            const fixture = new Set<string>([many, few, late, early, idA, idB]);
            const order = body.data
                .map((row: { userId: string }) => row.userId)
                .filter((id: string) => fixture.has(id));
            expect(order).toEqual([
                few,
                many,
                early,
                late,
                ...[idA, idB].sort(),
            ]);
        });

        it("shows another player's finish on the next read", async () => {
            const viewer = await createUser("fresh_viewer");
            const scorer = await createUser("fresh_scorer");
            const cover = await puzzle(today);
            await addResult(viewer, cover, { points: 10 });
            await recompute(today, viewer);

            const before = await ranking(
                { period: "today", mode: "cover", limit: 100 },
                viewer,
            );
            expect(
                before.data.some(
                    (row: { userId: string }) => row.userId === scorer,
                ),
            ).toBe(false);

            await dailyService.play(scorer, cover.id, {
                guesses: [ANSWER_ID],
            });

            const after = await ranking(
                { period: "today", mode: "cover", limit: 100 },
                viewer,
            );
            expect(
                after.data.find(
                    (row: { userId: string }) => row.userId === scorer,
                ),
            ).toMatchObject({ points: 6 });
        });

        it("limits the following scope to the viewer and followed players", async () => {
            const viewer = await createUser("scope_viewer");
            const followedA = await createUser("scope_a");
            const followedB = await createUser("scope_b");
            const stranger = await createUser("scope_c");
            const keywords = await puzzle(today, DailyMode.KEYWORDS);
            await addResult(viewer, keywords, { points: 10, attempts: 1 });
            await addResult(followedA, keywords, { points: 20, attempts: 1 });
            await addResult(
                followedB,
                await puzzle(addDays(today, -1), DailyMode.KEYWORDS),
                {
                    points: 15,
                },
            );
            await addResult(stranger, keywords, { points: 30 });
            await recompute(today, viewer, followedA, followedB, stranger);
            await follow(viewer, followedA);
            await follow(viewer, followedB);
            supporterIds = [viewer, followedA, followedB];
            await hideBadge(followedB);

            const body = await ranking(
                {
                    period: "all",
                    mode: "keywords",
                    scope: "following",
                    limit: 100,
                },
                viewer,
            );
            expect(body.scope).toBe("following");
            expect(body.totalPlayers).toBe(3);
            expect(
                body.data.map((row: { userId: string }) => row.userId),
            ).toEqual([followedA, followedB, viewer]);
            expect(
                body.data.map((row: { position: number }) => row.position),
            ).toEqual([1, 2, 3]);
            expect(body.data[0].supporterBadge).toBe(true);
            expect(body.data[1].supporterBadge).toBe(false);
            expect(body.viewer.supporterBadge).toBe(true);

            await get("/v1/daily/ranking")
                .query({ scope: "following" })
                .expect(401);
        });

        it("pages rows, counts players and points the viewer to the top 100", async () => {
            const viewer = await createUser("top100");
            const specs = await puzzle(today, DailyMode.SPECS);
            const others = Array.from({ length: 100 }, (_, index) => index);
            const seeded: string[] = [];
            for (const index of others) {
                const userId = await createUser(`top100_${index}`);
                await addResult(userId, specs, { points: 20 });
                seeded.push(userId);
            }
            await addResult(viewer, specs, { points: 10 });
            await recompute(today, ...seeded, viewer);

            const firstPage = await ranking(
                { period: "today", mode: "specs", limit: 100 },
                viewer,
            );
            expect(firstPage.totalPlayers).toBe(101);
            expect(firstPage.data).toHaveLength(100);
            expect(firstPage.data[0].position).toBe(1);
            expect(firstPage.viewer).toMatchObject({
                position: 101,
                points: 1,
            });
            expect(firstPage.pointsToTop100).toBe(1);
            expect(firstPage.viewer.username).toContain("top100_");

            const secondPage = await ranking(
                { period: "today", mode: "specs", offset: 10, limit: 10 },
                viewer,
            );
            expect(secondPage.data).toHaveLength(10);
            expect(secondPage.data[0].position).toBe(11);
            expect(secondPage.pagination).toEqual({
                totalItems: 101,
                totalPages: 11,
                hasNextPage: true,
            });
        });

        it("serves guests the list without a viewer row", async () => {
            const body = await ranking({ period: "today", mode: "cover" });
            expect(body.viewer).toBeNull();
            expect(body.pointsToTop100).toBeNull();
            expect(Array.isArray(body.data)).toBe(true);
        });

        it("rejects an unknown period, mode, scope or out of range page", async () => {
            for (const query of [
                { period: "year" },
                { mode: "wrong" },
                { scope: "friends" },
                { limit: 101 },
                { limit: 0 },
                { offset: -1 },
            ])
                await get("/v1/daily/ranking").query(query).expect(400);
        });
    });

    describe("weekly challenge", () => {
        const monday = mondayOf(today);

        it("reports a null entry when this week has no challenge", async () => {
            await dataSource.query(
                "DELETE FROM daily_puzzle WHERE kind = 'weekly' AND date = ?",
                [monday],
            );
            const userId = await createUser("weekly_missing");
            const body = await get("/v1/daily", userId).expect(200);
            expect(body.body.weekly).toBeNull();
        });

        it("lists this week's challenge with the viewer's result once it is played", async () => {
            const weekly = await puzzle(monday, DailyMode.SPECS, "weekly");
            const userId = await createUser("weekly_player");

            const before = await get("/v1/daily", userId).expect(200);
            expect(before.body.weekly).toEqual({
                id: weekly.id,
                number: weekly.number,
                mode: "specs",
                maxAttempts: 10,
                endsAt: dailyNextResetAt(addDays(monday, 6)),
            });

            const played = await post(
                `/v1/daily/puzzles/${weekly.id}/play`,
                userId,
                { guesses: [ANSWER_ID] },
            ).expect(201);
            expect(played.body.status).toBe(DailyStatus.WON);
            // Weekly plays never carry the daily ranking summary.
            expect(played.body.ranking).toBeUndefined();

            const after = await get("/v1/daily", userId).expect(200);
            expect(after.body.weekly.result).toEqual({
                status: DailyStatus.WON,
                attempts: 1,
            });
        });

        it("rejects next week's challenge as not found", async () => {
            const next = await puzzle(
                addDays(monday, 7),
                DailyMode.SPECS,
                "weekly",
            );
            const userId = await createUser("weekly_future");
            await post(`/v1/daily/puzzles/${next.id}/play`, userId, {
                guesses: [ANSWER_ID],
            }).expect(404);
        });

        it("ranks the viewer against followed players who finished, winners first", async () => {
            const weekly = await puzzle(monday, DailyMode.SPECS, "weekly");
            const viewer = await createUser("weekly_rank_viewer");
            const quick = await createUser("weekly_rank_quick");
            const slow = await createUser("weekly_rank_slow");
            const tied = await createUser("weekly_rank_tied");
            const lost = await createUser("weekly_rank_lost");
            const unfinished = await createUser("weekly_rank_unfinished");
            const imported = await createUser("weekly_rank_imported");
            for (const followed of [
                quick,
                slow,
                tied,
                lost,
                unfinished,
                imported,
            ])
                await follow(viewer, followed);

            await addResult(viewer, weekly, { attempts: 4 });
            await addResult(quick, weekly, { attempts: 3 });
            await addResult(slow, weekly, {
                attempts: 5,
                finishedAt: `${monday} 09:00:00`,
            });
            // Same attempts as `slow`: the earlier finish comes first.
            await addResult(tied, weekly, {
                attempts: 5,
                finishedAt: `${monday} 10:00:00`,
            });
            await addResult(lost, weekly, {
                status: DailyStatus.LOST,
                attempts: 10,
            });
            await addResult(unfinished, weekly, {
                status: DailyStatus.IN_PROGRESS,
                ranked: 0,
                attempts: 2,
                finishedAt: null,
            });
            // Imported guest plays are saved but never ranked.
            await addResult(imported, weekly, { attempts: 1, ranked: 0 });
            supporterIds = [quick, lost];
            await hideBadge(lost);

            const body = await get("/v1/daily/weekly/ranking", viewer).expect(
                200,
            );
            expect(body.body.weekly.id).toBe(weekly.id);
            expect(
                body.body.data.map((row: { userId: string }) => row.userId),
            ).toEqual([quick, viewer, slow, tied, lost]);
            expect(
                body.body.data.map((row: { attempts: number }) => row.attempts),
            ).toEqual([3, 4, 5, 5, 10]);
            expect(body.body.data[0].supporterBadge).toBe(true);
            expect(body.body.data[4].supporterBadge).toBe(false);
            expect(
                body.body.data.map(
                    (row: { status: DailyStatus }) => row.status,
                ),
            ).toEqual([
                DailyStatus.WON,
                DailyStatus.WON,
                DailyStatus.WON,
                DailyStatus.WON,
                DailyStatus.LOST,
            ]);

            await get("/v1/daily/weekly/ranking").expect(401);
        });
    });
});
