import "reflect-metadata";
import { randomUUID } from "node:crypto";
import dayjs from "dayjs";
import { Between, DataSource } from "typeorm";
import { VersioningType } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { RecapCreateService } from "./recap-create.service";
import { RecapController } from "./recap.controller";
import { RecapService } from "./recap.service";
import { RecapWindowService } from "./recap-window.service";
import { RecapGoalsService } from "./recap-goals.service";
import { AuthService } from "../auth/auth.service";
import { createAwardsTestDatabase } from "../../test/awards/awards-test-database";
import {
    addTransactionalDataSource,
    deleteDataSourceByName,
    initializeTransactionalContext,
    StorageDriver,
} from "typeorm-transactional";
import { YearRecap } from "./entity/year-recap.entity";
import { CollectionEntry } from "../collections/collections-entries/entities/collection-entry.entity";
import { UserPlaytimeHistory } from "../playtime/entity/user-playtime-history.entity";
import { PlaytimeHistoryService } from "../playtime/playtime-history.service";
import { recapCacheId } from "./recap.utils";

describe("recap likes from retained statistics facts", () => {
    let dataSource: DataSource;
    let service: RecapCreateService;

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();
        service = new RecapCreateService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, dataSource);
    });

    afterAll(async () => {
        if (dataSource?.isInitialized) await dataSource.destroy();
    });

    it("counts retained additions after unlike with an exact end-exclusive boundary", async () => {
        const actor = randomUUID();
        await dataSource.query(
            "INSERT IGNORE INTO profile (userId, username, createdAt, updatedAt) VALUES (?, ?, NOW(), NOW())",
            [actor, `u_${actor.slice(0, 16)}`],
        );
        const target = await dataSource.query("INSERT INTO statistics_target (sourceType, isActive) VALUES ('post', 1)");
        const targetId = Number(target.insertId);
        await dataSource.query(
            `INSERT INTO statistics_event (eventKey, eventVersion, eventKind, targetId, actorUserId, occurredAt, projectionState, nextAttemptAt)
             VALUES (?, 1, 'like.added', ?, ?, '2024-01-01 00:00:00.000000', 'done', CURRENT_TIMESTAMP(6)),
                    (?, 1, 'like.removed', ?, ?, '2024-01-01 12:00:00.000000', 'done', CURRENT_TIMESTAMP(6)),
                    (?, 1, 'like.added', ?, ?, '2024-01-02 00:00:00.000000', 'done', CURRENT_TIMESTAMP(6))`,
            [randomUUID(), targetId, actor, randomUUID(), targetId, actor, randomUUID(), targetId, actor],
        );

        const result = await (service as any).getLikesPerformedInPeriod(actor, {
            startDate: dayjs("2024-01-01T00:00:00.000Z"),
            endDate: dayjs("2024-01-01T23:59:59.999Z"),
        });

        expect(result).toMatchObject({ total: 1, historyComplete: true });
        expect(result.completeSince).toBeNull();
    });

    it("excludes zero-contribution playtime rows from recap games", async () => {
        const recap = new RecapCreateService(
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {
                getTotalPlaytimeForPeriod: jest.fn().mockResolvedValue([
                    {
                        gameId: 1,
                        platformId: 6,
                        source: "steam",
                        totalPlaytimeInPeriodSeconds: 0,
                    },
                    {
                        gameId: 2,
                        platformId: 6,
                        source: "steam",
                        totalPlaytimeInPeriodSeconds: 60,
                        estimatedPlaytimeSeconds: 36,
                    },
                ]),
            } as any,
            {} as any,
            {} as any,
            dataSource,
        );

        const result = await (recap as any).getPlayedGamesInPeriod(
            randomUUID(),
            {
                startDate: dayjs("2026-01-01T00:00:00.000Z"),
                endDate: dayjs("2027-01-01T00:00:00.000Z"),
            },
            [],
        );

        expect(result.totalPlaytimeInPeriodSeconds).toBe(60);
        expect(result.playedGames).toHaveLength(1);
        expect(result.playedGames[0]).toMatchObject({
            gameId: 2,
            totalPlaytimeSeconds: 60,
        });
    });
});

describe("recap generation from seeded statistics", () => {
    jest.setTimeout(120000);

    const database = "recap_generation_test";
    const year = 2026;
    const user = randomUUID();
    const emptyUser = randomUUID();
    const gameA = 9_000_000_000_001;
    const gameB = 9_000_000_000_002;
    const gameC = 9_000_000_000_003;
    const gameD = 9_000_000_000_004;
    const platformId = 9_000_000_000_010;

    let cleanup: () => Promise<void>;
    let dataSource: DataSource;
    let service: RecapCreateService;
    let entries: Map<number, string>;

    const addUser = async (userId: string, createdAt = "2025-01-01") => {
        await dataSource.query(
            "INSERT INTO profile (userId, username, createdAt, updatedAt) VALUES (?, ?, ?, NOW())",
            [userId, `u_${userId.slice(0, 16)}`, `${createdAt} 00:00:00`],
        );
        await dataSource.query("INSERT IGNORE INTO library (userId) VALUES (?)", [
            userId,
        ]);
    };

    const addEntry = async (
        userId: string,
        gameId: number,
        options: {
            startedAt?: string | null;
            finishedAt?: string | null;
            droppedAt?: string | null;
            status?: string;
            createdAt?: string;
            withPlatform?: boolean;
        } = {},
    ) => {
        const id = randomUUID();
        const createdAt = options.createdAt ?? `${year}-01-02`;
        await dataSource.query(
            `INSERT INTO collection_entry
                (id, gameId, status, libraryUserId, startedAt, finishedAt, droppedAt, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                gameId,
                options.status ?? "planned",
                userId,
                options.startedAt ?? null,
                options.finishedAt ?? null,
                options.droppedAt ?? null,
                `${createdAt} 00:00:00`,
                `${createdAt} 00:00:00`,
            ],
        );
        if (options.withPlatform) {
            await dataSource.query(
                "INSERT INTO collection_entry_owned_platforms_game_platform (collectionEntryId, gamePlatformId) VALUES (?, ?)",
                [id, platformId],
            );
        }
        return id;
    };

    const addHistory = async (
        userId: string,
        gameId: number,
        totalPlaytimeSeconds: number,
        createdAt: string,
    ) => {
        await dataSource.query(
            `INSERT INTO user_playtime_history
                (source, profileUserId, gameId, totalPlaytimeSeconds, recentPlaytimeSeconds,
                 totalPlayCount, platformId, createdAt)
             VALUES ('steam', ?, ?, ?, 0, 0, ?, ?)`,
            [userId, gameId, totalPlaytimeSeconds, platformId, `${createdAt} 00:00:00`],
        );
    };

    const addReview = async (
        userId: string,
        gameId: number,
        collectionEntryId: string,
        rating: number,
        createdAt = `${year}-03-05`,
    ) => {
        await dataSource.query(
            `INSERT INTO review (id, rating, gameId, profileUserId, collectionEntryId, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                randomUUID(),
                rating,
                gameId,
                userId,
                collectionEntryId,
                `${createdAt} 00:00:00`,
                `${createdAt} 00:00:00`,
            ],
        );
    };

    const outbox = async (recipientUserId = user) =>
        (
            await dataSource.query(
                "SELECT eventType, payload FROM notification_outbox WHERE recipientUserId = ? AND eventType = 'recap.milestone' ORDER BY id",
                [recipientUserId],
            )
        ).map((row: { eventType: string; payload: unknown }) => ({
            eventType: row.eventType,
            payload:
                typeof row.payload === "string"
                    ? JSON.parse(row.payload)
                    : row.payload,
        }));

    const loadRecap = async (profileUserId = user) =>
        dataSource.getRepository(YearRecap).findOneOrFail({
            where: { profileUserId, year },
            relations: { playedGames: true },
        });

    beforeAll(async () => {
        initializeTransactionalContext({
            storageDriver: StorageDriver.ASYNC_LOCAL_STORAGE,
        });
        const disposable = await createAwardsTestDatabase(database);
        cleanup = disposable.destroy;
        dataSource = disposable.source;
        addTransactionalDataSource(dataSource);

        await dataSource.query(
            "INSERT INTO game (id, name, slug) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?)",
            [
                gameA,
                "Seeded A",
                "seeded-a",
                gameB,
                "Seeded B",
                "seeded-b",
                gameC,
                "Seeded C",
                "seeded-c",
                gameD,
                "Seeded D",
                "seeded-d",
            ],
        );
        await dataSource.query(
            "INSERT INTO game_platform (id, name, abbreviation, category) VALUES (?, ?, ?, 1)",
            [platformId, "Seed Platform", "SEED"],
        );
        await addUser(user);
        await addUser(emptyUser);

        entries = new Map([
            [
                gameA,
                await addEntry(user, gameA, {
                    status: "finished",
                    startedAt: `${year}-02-20 00:00:00`,
                    finishedAt: `${year}-03-02 00:00:00`,
                }),
            ],
            [
                gameB,
                await addEntry(user, gameB, {
                    status: "playing",
                    startedAt: `${year}-04-09 00:00:00`,
                }),
            ],
            [
                gameC,
                await addEntry(user, gameC, {
                    status: "finished",
                    startedAt: `${year}-05-01 00:00:00`,
                    finishedAt: `${year}-05-20 00:00:00`,
                    withPlatform: true,
                }),
            ],
            [
                gameD,
                await addEntry(user, gameD, {
                    status: "dropped",
                    droppedAt: `${year}-06-01 00:00:00`,
                }),
            ],
        ]);

        await addHistory(user, gameA, 100, "2025-12-31");
        await addHistory(user, gameA, 4_600, `${year}-03-02`);
        await addHistory(user, gameA, 5_600, `${year}-03-03`);
        await addHistory(user, gameB, 0, `${year}-04-09`);
        await addHistory(user, gameB, 7_200, `${year}-04-10`);

        await addReview(user, gameA, entries.get(gameA)!, 4.5);
        await addReview(user, gameB, entries.get(gameB)!, 4.5);

        for (let index = 0; index < 20; index++) {
            const reviewer = randomUUID();
            await addUser(reviewer);
            const entryA = await addEntry(reviewer, gameA, {
                status: "finished",
                finishedAt: `${year}-03-10 00:00:00`,
            });
            await addReview(reviewer, gameA, entryA, 3.0);
            const entryB = await addEntry(reviewer, gameB, {
                status: "finished",
                finishedAt: `${year}-04-15 00:00:00`,
            });
            await addReview(reviewer, gameB, entryB, 4.6);
        }

        service = new RecapCreateService(
            dataSource.getRepository(YearRecap),
            { findAllByUserIdWithPermissions: async () => [] } as any,
            {
                findAllByUserIdInPeriod: async (
                    userId: string,
                    period: { startDate: Date; endDate: Date },
                ) =>
                    dataSource.getRepository(CollectionEntry).find({
                        where: {
                            libraryUserId: userId,
                            updatedAt: Between(period.startDate, period.endDate),
                        },
                        relations: { ownedPlatforms: true },
                    }),
            } as any,
            { getTypeDistribution: async () => ({ distribution: [] }) } as any,
            new PlaytimeHistoryService(
                dataSource.getRepository(UserPlaytimeHistory),
                {} as any,
            ),
            {
                findAllByUserId: async (userId: string) => {
                    const reviews = await dataSource.query(
                        "SELECT gameId, rating, createdAt FROM review WHERE profileUserId = ?",
                        [userId],
                    );
                    return [reviews, reviews.length];
                },
            } as any,
            { countFollowers: async () => 0 } as any,
            dataSource,
        );
    });

    afterAll(async () => {
        deleteDataSourceByName("default");
        await cleanup?.();
    });

    it("writes the finished, dropped, added and daily statistics from seeded data", async () => {
        await service.createRecap(user, year, { final: false });

        const recap = await loadRecap();

        expect(recap.totalFinishedGames).toBe(2);
        expect(recap.totalDroppedGames).toBe(1);
        expect(recap.totalAddedGames).toBe(4);
        expect(recap.totalPlaytimeSeconds).toBe(12_700);
        expect(recap.dailyPlaytimeSeconds).toHaveLength(365);
        expect(
            recap.dailyPlaytimeSeconds![
                dayjs.utc(`${year}-03-02`).diff(dayjs.utc(`${year}-01-01`), "day")
            ],
        ).toBe(4_500);
        expect(
            recap.dailyPlaytimeSeconds![
                dayjs.utc(`${year}-03-03`).diff(dayjs.utc(`${year}-01-01`), "day")
            ],
        ).toBe(1_000);
        expect(
            recap.dailyPlaytimeSeconds!.reduce((total, seconds) => total + seconds, 0),
        ).toBe(12_700);

        const playedA = recap.playedGames.find((game) => game.gameId === gameA)!;
        const playedB = recap.playedGames.find((game) => game.gameId === gameB)!;
        const playedC = recap.playedGames.find((game) => game.gameId === gameC)!;
        expect(playedA.firstPlayedAt).toBe(`${year}-03-02`);
        expect(playedA.finishedAt).toEqual(new Date(`${year}-03-02T00:00:00.000Z`));
        expect(playedA.rating).toBe(4.5);
        expect(playedB.firstPlayedAt).toBe(`${year}-04-10`);
        expect(playedB.finishedAt).toBeNull();
        expect(playedB.rating).toBe(4.5);
        expect(playedC.firstPlayedAt).toBe(`${year}-05-01`);
        expect(playedC.rating).toBeNull();

        expect(recap.communityHighlights?.minority).toMatchObject({
            gameId: gameA,
            userRating: 4.5,
            communityAverage: 3,
            reviewCount: 20,
            beyondShare: 0,
            sameRangeCount: 0,
        });
        expect(recap.communityHighlights?.inTune).toMatchObject({
            gameId: gameB,
            userRating: 4.5,
            communityAverage: 4.6,
            reviewCount: 20,
            sameRangeCount: 20,
        });

        await expect(outbox()).resolves.toEqual([
            {
                eventType: "recap.milestone",
                payload: { year, milestone: "available" },
            },
        ]);
    });

    it("regenerates without a unique-index error and clears the read cache", async () => {
        const cache = {
            remove: jest.fn(async () => undefined),
            disconnect: async () => undefined,
        };
        (dataSource as any).queryResultCache = cache;
        await addHistory(user, gameA, 6_600, `${year}-07-01`);

        await service.createRecap(user, year, { final: false });

        const recaps = await dataSource.getRepository(YearRecap).find({
            where: { profileUserId: user, year },
            relations: { playedGames: true },
        });
        expect(recaps).toHaveLength(1);
        expect(recaps[0].totalPlaytimeSeconds).toBe(13_700);
        expect(
            recaps[0].playedGames.filter((game) => game.gameId === gameA),
        ).toHaveLength(1);
        expect(cache.remove).toHaveBeenCalledWith([recapCacheId(user, year)]);
        expect(await outbox()).toHaveLength(1);
    });

    it("keeps the previous Recap readable when regeneration fails", async () => {
        const before = await loadRecap();
        const playedBefore = before.playedGames.length;
        const save = jest
            .spyOn((service as any).recapRepository, "save")
            .mockRejectedValueOnce(new Error("injected recap write failure"));

        await expect(
            service.createRecap(user, year, { final: false }),
        ).rejects.toThrow("injected recap write failure");
        save.mockRestore();

        const after = await loadRecap();
        expect(after.id).toBe(before.id);
        expect(after.totalPlaytimeSeconds).toBe(before.totalPlaytimeSeconds);
        expect(after.playedGames).toHaveLength(playedBefore);
    });

    it("finalizes once after data exists and never regenerates a final Recap", async () => {
        await service.createRecap(user, year, { final: true });

        const final = await loadRecap();
        expect(final.isFinal).toBe(true);
        await expect(outbox()).resolves.toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    payload: { year, milestone: "available" },
                }),
                expect.objectContaining({
                    payload: { year, milestone: "closed" },
                }),
            ]),
        );

        await addHistory(user, gameA, 9_900, `${year}-08-01`);
        await service.createRecap(user, year, { final: true });
        await service.createRecap(user, year, { final: false });

        const unchanged = await loadRecap();
        expect(unchanged.id).toBe(final.id);
        expect(unchanged.totalPlaytimeSeconds).toBe(13_700);
        expect(await outbox()).toHaveLength(2);
    });

    it("sends no availability notification for an empty Recap", async () => {
        await service.createRecap(emptyUser, year, { final: false });

        const empty = await loadRecap(emptyUser);
        expect(empty.totalPlayedGames).toBe(0);
        expect(empty.totalAddedGames).toBe(0);
        await expect(outbox(emptyUser)).resolves.toHaveLength(0);
    });

    it("serializes concurrent generations so the final Recap survives with one closed notification", async () => {
        const finalUser = randomUUID();
        const liveUser = randomUUID();
        await addUser(finalUser);
        await addUser(liveUser);
        await addEntry(finalUser, gameA, {
            status: "playing",
            startedAt: `${year}-02-20 00:00:00`,
        });
        await addHistory(finalUser, gameA, 100, "2025-12-31");
        await addHistory(finalUser, gameA, 5_000, `${year}-03-02`);
        await addEntry(liveUser, gameB, { status: "planned" });

        await Promise.all([
            service.createRecap(finalUser, year, { final: false }),
            service.createRecap(finalUser, year, { final: true }),
            service.createRecap(finalUser, year, { final: false }),
        ]);

        const recaps = await dataSource.getRepository(YearRecap).find({
            where: { profileUserId: finalUser, year },
            relations: { playedGames: true },
        });
        expect(recaps).toHaveLength(1);
        expect(recaps[0].isFinal).toBe(true);
        expect(recaps[0].totalPlaytimeSeconds).toBe(4_900);
        expect(
            recaps[0].playedGames.filter((game) => game.gameId === gameA),
        ).toHaveLength(1);
        const closed = (await outbox(finalUser)).filter(
            (row: { payload: unknown }) =>
                (row.payload as { milestone: string }).milestone === "closed",
        );
        expect(closed).toHaveLength(1);

        await Promise.all([
            service.createRecap(liveUser, year, { final: false }),
            service.createRecap(liveUser, year, { final: false }),
        ]);

        const liveRecaps = await dataSource.getRepository(YearRecap).find({
            where: { profileUserId: liveUser, year },
        });
        expect(liveRecaps).toHaveLength(1);
        expect(liveRecaps[0].isFinal).toBe(false);
        expect(
            (await outbox(liveUser)).filter(
                (row: { payload: unknown }) =>
                    (row.payload as { milestone: string }).milestone ===
                    "available",
            ),
        ).toHaveLength(1);
    });

    it("reports no community highlight when the played game has fewer than 20 other reviews", async () => {
        const quietUser = randomUUID();
        await addUser(quietUser);
        const entry = await addEntry(quietUser, gameC, {
            status: "playing",
            startedAt: `${year}-06-01 00:00:00`,
            withPlatform: true,
        });
        await addReview(quietUser, gameC, entry, 4.5);

        for (let index = 0; index < 19; index++) {
            const reviewer = randomUUID();
            await addUser(reviewer);
            const reviewerEntry = await addEntry(reviewer, gameC, {
                status: "finished",
                finishedAt: `${year}-06-10 00:00:00`,
            });
            await addReview(reviewer, gameC, reviewerEntry, 3.0);
        }

        await service.createRecap(quietUser, year, { final: false });

        const recap = await loadRecap(quietUser);
        expect(recap.communityHighlights).toEqual({
            minority: null,
            inTune: null,
        });
    });

    it("returns the full Recap to an unauthenticated visitor", async () => {
        (dataSource as any).queryResultCache = undefined;
        const moduleRef = await Test.createTestingModule({
            controllers: [RecapController],
            providers: [
                {
                    provide: RecapService,
                    useValue: new RecapService(
                        dataSource.getRepository(YearRecap),
                        {} as any,
                        {} as any,
                    ),
                },
                { provide: RecapWindowService, useValue: {} },
                { provide: RecapGoalsService, useValue: {} },
                { provide: AuthService, useValue: {} },
            ],
        }).compile();
        const app = moduleRef.createNestApplication();
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
        await app.init();
        try {
            const response = await request(app.getHttpServer())
                .get(`/v1/recap/${year}/${user}`)
                .expect(200);

            expect(response.body).toMatchObject({
                profileUserId: user,
                year,
                isFinal: true,
            });
            expect(response.body.playedGames).toHaveLength(3);
            expect(response.body.dailyPlaytimeSeconds).toHaveLength(365);
            expect(response.body.calendar.monthlyPlaytimeSeconds).toHaveLength(
                12,
            );
            expect(response.body.topGames).toHaveLength(3);
        } finally {
            await app.close();
        }
    });
});
