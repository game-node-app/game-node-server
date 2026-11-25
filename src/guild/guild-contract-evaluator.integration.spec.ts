import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { createAwardsTestDatabase } from "../../test/awards/awards-test-database";
import { CollectionEntryStatus } from "../collections/collections-entries/collections-entries.constants";
import type { CollectionEntryStatusHistorySource } from "../collections/collections-entries/collections-entries.constants";
import { DailyMode, DailyStatus } from "../daily/daily.constants";
import { UserPlaytimeHistory } from "../playtime/entity/user-playtime-history.entity";
import { PlaytimeHistoryService } from "../playtime/playtime-history.service";
import { GameTimeToBeat } from "./entities/game-time-to-beat.entity";
import { GuildContract } from "./entities/guild-contract.entity";
import {
    GuildBonusObjective,
    GuildCategory,
    GuildContractStatus,
    GuildCriteria,
    GuildObjectiveType,
    GuildRank,
} from "./guild.constants";
import { GUILD_OBJECTIVE_EVALUATORS } from "./evaluators";
import { gameMatchesGuildCriteria } from "./evaluators/game-criteria";
import { GuildContractEvaluatorService } from "./guild-contract-evaluator.service";
import { GuildTimeToBeatService } from "./guild-time-to-beat.service";

const NOW = new Date("2026-06-17T12:00:00Z");
const AN_HOUR = 60 * 60 * 1000;
const A_DAY = 24 * AN_HOUR;

describe("Guild contract evaluator (integration)", () => {
    jest.setTimeout(120000);

    const database = `guild_test_evaluator_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    let db: Awaited<ReturnType<typeof createAwardsTestDatabase>>;
    let source: DataSource;
    let evaluator: GuildContractEvaluatorService;
    let nextGameId = 8_100_000;
    let nextPlatformId = 8_200_000;
    let nextTaxonomyId = 8_300_000;
    let nextExternalGameId = 8_400_000;
    let nextPuzzleId = 8_500_000;

    beforeAll(async () => {
        db = await createAwardsTestDatabase(database);
        source = db.source;
        const timeToBeat = new GuildTimeToBeatService(
            source.getRepository(GameTimeToBeat),
            { getTimesToBeat: jest.fn().mockResolvedValue([]) } as any,
        );
        evaluator = new GuildContractEvaluatorService(
            source,
            timeToBeat,
            new PlaytimeHistoryService(
                source.getRepository(UserPlaytimeHistory),
                {} as any,
            ),
        );
    });

    afterAll(async () => {
        await db?.destroy();
    });

    async function user() {
        const userId = randomUUID();
        await source.query(
            "INSERT INTO profile (userId, username, createdAt) VALUES (?, ?, ?)",
            [
                userId,
                `u-${userId.slice(0, 8)}`,
                new Date("2025-01-02T00:00:00Z"),
            ],
        );
        await source.query("INSERT INTO library (userId) VALUES (?)", [userId]);
        return userId;
    }

    async function game(
        values: {
            firstReleaseDate?: Date;
            category?: number;
        } = {},
    ) {
        const id = nextGameId++;
        await source.query(
            "INSERT INTO game (id, name, slug, category, firstReleaseDate) VALUES (?, ?, ?, ?, ?)",
            [
                id,
                `Game ${id}`,
                `game-${id}`,
                values.category ?? 0,
                values.firstReleaseDate ?? null,
            ],
        );
        return id;
    }

    async function platform() {
        const id = nextPlatformId++;
        await source.query(
            "INSERT INTO game_platform (id, name) VALUES (?, ?)",
            [id, `Platform ${id}`],
        );
        return id;
    }

    async function taxonomy(table: string, name: string) {
        const id = nextTaxonomyId++;
        await source.query(`INSERT INTO ${table} (id, name) VALUES (?, ?)`, [
            id,
            `${name} ${id}`,
        ]);
        return id;
    }

    async function insertContract(
        userId: string,
        values: {
            objectiveType: GuildObjectiveType;
            targetCount?: number;
            criteria?: GuildCriteria;
            targetGameId?: number | null;
            acceptedAt?: Date;
            expiresAt?: Date | null;
            bonusObjective?: GuildBonusObjective | null;
        },
    ) {
        const id = randomUUID();
        await source.query(
            `INSERT INTO guild_contract
                (id, profileUserId, boardEntryId, eventId, category, templateKey, \`rank\`, xpReward,
                 sealsReward, objectiveType, criteria, bonusObjective, bonusCompleted, extendedCount,
                 chainProgressId, targetGameId, progressCurrent, progressTarget, status, rewardId,
                 claimPayload, acceptedAt, readyAt, claimedAt, expiresAt)
             VALUES (?, ?, NULL, NULL, ?, 'weekend_sprint', ?, 100, 0, ?, ?, ?, 0, 0,
                     NULL, ?, 0, ?, ?, NULL, NULL, ?, NULL, NULL, ?)`,
            [
                id,
                userId,
                GuildCategory.WEEKLY,
                GuildRank.D,
                values.objectiveType,
                JSON.stringify(values.criteria ?? {}),
                values.bonusObjective
                    ? JSON.stringify(values.bonusObjective)
                    : null,
                values.targetGameId ?? null,
                values.targetCount ?? 1,
                GuildContractStatus.ACTIVE,
                values.acceptedAt ?? NOW,
                values.expiresAt === undefined ? null : values.expiresAt,
            ],
        );
        return id;
    }

    async function contractOf(contractId: string) {
        return source
            .getRepository(GuildContract)
            .findOneByOrFail({ id: contractId });
    }

    async function entry(
        userId: string,
        gameId: number,
        values: {
            status?: CollectionEntryStatus;
            createdAt?: Date;
            plannedAt?: Date | null;
            finishedAt?: Date | null;
            startedAt?: Date | null;
            droppedAt?: Date | null;
        } = {},
    ) {
        const id = randomUUID();
        const createdAt =
            values.createdAt ?? new Date(NOW.getTime() - 90 * A_DAY);
        const status = values.status ?? CollectionEntryStatus.PLANNED;
        await source.query(
            `INSERT INTO collection_entry
                (id, gameId, libraryUserId, status, createdAt, plannedAt, startedAt, finishedAt, droppedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                gameId,
                userId,
                status,
                createdAt,
                values.plannedAt === undefined ? createdAt : values.plannedAt,
                values.startedAt ?? null,
                values.finishedAt ?? null,
                values.droppedAt ?? null,
            ],
        );
        await statusHistory(userId, gameId, status, createdAt, {
            entryId: id,
            fromStatus: null,
        });
        return id;
    }

    async function statusHistory(
        userId: string,
        gameId: number,
        toStatus: CollectionEntryStatus,
        occurredAt: Date,
        values: {
            fromStatus?: CollectionEntryStatus | null;
            source?: CollectionEntryStatusHistorySource;
            entryId?: string | null;
        } = {},
    ) {
        await source.query(
            `INSERT INTO collection_entry_status_history
                (libraryUserId, gameId, collectionEntryId, fromStatus, toStatus, source, occurredAt)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                userId,
                gameId,
                values.entryId ?? null,
                values.fromStatus ?? null,
                toStatus,
                values.source ?? "manual",
                occurredAt,
            ],
        );
    }

    async function moveEntry(
        userId: string,
        gameId: number,
        fromStatus: CollectionEntryStatus,
        toStatus: CollectionEntryStatus,
        occurredAt: Date,
        sourceValue: CollectionEntryStatusHistorySource = "manual",
    ) {
        const [row] = await source.query(
            "SELECT id FROM collection_entry WHERE libraryUserId = ? AND gameId = ? LIMIT 1",
            [userId, gameId],
        );
        await statusHistory(userId, gameId, toStatus, occurredAt, {
            fromStatus,
            source: sourceValue,
            entryId: row?.id ?? null,
        });
    }

    async function review(
        userId: string,
        gameId: number,
        createdAt: Date,
        content: string,
    ) {
        const [row] = await source.query(
            "SELECT id FROM collection_entry WHERE libraryUserId = ? AND gameId = ? LIMIT 1",
            [userId, gameId],
        );
        await source.query(
            `INSERT INTO review
                (id, content, rating, gameId, profileUserId, collectionEntryId, createdAt, updatedAt)
             VALUES (?, ?, 4, ?, ?, ?, ?, ?)`,
            [
                randomUUID(),
                content,
                gameId,
                userId,
                row.id,
                createdAt,
                createdAt,
            ],
        );
    }

    async function observation(
        userId: string,
        gameId: number,
        platformId: number,
        totalPlaytimeSeconds: number,
        createdAt: Date,
    ) {
        await source.query(
            `INSERT INTO user_playtime_history
                (source, profileUserId, gameId, totalPlaytimeSeconds, recentPlaytimeSeconds,
                 lastPlayedDate, firstPlayedDate, totalPlayCount, platformId, checksum, createdAt, updatedAt)
             VALUES ('steam', ?, ?, ?, 0, ?, NULL, 1, ?, NULL, ?, ?)`,
            [
                userId,
                gameId,
                totalPlaytimeSeconds,
                createdAt,
                platformId,
                createdAt,
                createdAt,
            ],
        );
    }

    async function evaluate(userId: string, at: Date) {
        await evaluator.evaluateUserContracts(userId, at);
    }

    async function externalGame(gameId: number) {
        const id = nextExternalGameId++;
        await source.query(
            `INSERT INTO game_external_game (id, uid, category, gameId, origin)
             VALUES (?, ?, 1, ?, 'igdb')`,
            [id, `steam-${id}`, gameId],
        );
        return id;
    }

    async function achievement(
        userId: string,
        externalGameId: number,
        externalAchievementId: string,
        obtainedAt: Date,
        createdAt: Date,
    ) {
        await source.query(
            `INSERT INTO obtained_game_achievement
                (externalAchievementId, profileUserId, externalGameId, obtainedAt, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                externalAchievementId,
                userId,
                externalGameId,
                obtainedAt,
                createdAt,
                createdAt,
            ],
        );
    }

    async function completionStatus(
        userId: string,
        externalGameId: number,
        values: {
            isCompleted?: boolean;
            isPlatinumObtained?: boolean;
            totalAvailableAchievements: number;
            completedAt: Date;
        },
    ) {
        await source.query(
            `INSERT INTO game_completion_status
                (externalGameId, profileUserId, isCompleted, isPlatinumObtained,
                 totalAvailableAchievements, totalObtainedAchievements, completedAt, checksum)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'checksum')`,
            [
                externalGameId,
                userId,
                values.isCompleted ?? false,
                values.isPlatinumObtained ?? false,
                values.totalAvailableAchievements,
                values.totalAvailableAchievements,
                values.completedAt,
            ],
        );
    }

    async function dailyResult(
        userId: string,
        values: {
            status: DailyStatus;
            hintAt?: number | null;
            attempts: number;
            finishedAt: Date | null;
        },
    ) {
        const puzzleId = nextPuzzleId++;
        await source.query(
            `INSERT INTO daily_puzzle (id, kind, mode, number, date, gameId, meta, source, createdAt)
             VALUES (?, 'daily', ?, ?, ?, ?, '{}', 'auto', ?)`,
            [
                puzzleId,
                DailyMode.COVER,
                puzzleId,
                `2026-06-${String((puzzleId % 27) + 1).padStart(2, "0")}`,
                await game(),
                NOW,
            ],
        );
        const resultId = randomUUID();
        await source.query(
            `INSERT INTO daily_result
                (userId, puzzleId, guesses, hintAt, status, ranked, points, attempts, finishedAt, createdAt, updatedAt)
             VALUES (?, ?, '[]', ?, ?, 0, 0, ?, ?, ?, ?)`,
            [
                userId,
                puzzleId,
                values.hintAt ?? null,
                values.status,
                values.attempts,
                values.finishedAt,
                NOW,
                NOW,
            ],
        );
        return resultId;
    }

    async function collection(
        userId: string,
        gameIds: number[],
        values: {
            description?: string;
            isPublic?: boolean;
            updatedAt: Date;
        },
    ) {
        const id = randomUUID();
        await source.query(
            `INSERT INTO collection
                (id, name, description, isPublic, libraryUserId, defaultEntryStatus,
                 isFeatured, isFinished, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, NULL, 0, 0, ?, ?)`,
            [
                id,
                `Collection ${id.slice(0, 8)}`,
                values.description ?? "A curated collection of great games.",
                values.isPublic ?? true,
                userId,
                values.updatedAt,
                values.updatedAt,
            ],
        );
        for (const gameId of gameIds) {
            const entryId = randomUUID();
            await source.query(
                `INSERT INTO collection_entry
                    (id, gameId, libraryUserId, status, createdAt, plannedAt)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    entryId,
                    gameId,
                    userId,
                    CollectionEntryStatus.PLANNED,
                    values.updatedAt,
                    values.updatedAt,
                ],
            );
            await source.query(
                `INSERT INTO collection_entry_collections_collection
                    (collectionEntryId, collectionId, \`order\`, createdAt)
                 VALUES (?, ?, 0, ?)`,
                [entryId, id, values.updatedAt],
            );
        }
        return id;
    }

    async function post(
        userId: string,
        gameId: number,
        content: string,
        createdAt: Date,
        deletedAt: Date | null = null,
    ) {
        const id = randomUUID();
        await source.query(
            `INSERT INTO post
                (id, content, profileUserId, gameId, statisticsTargetId, createdAt, updatedAt, deletedAt)
             VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
            [id, content, userId, gameId, createdAt, createdAt, deletedAt],
        );
        return id;
    }

    async function timeToBeat(gameId: number, normallySeconds: number) {
        await source.query(
            `INSERT INTO game_time_to_beat
                (gameId, hastilySeconds, normallySeconds, completelySeconds, submitCount, fetchedAt)
             VALUES (?, NULL, ?, NULL, 10, ?)`,
            [gameId, normallySeconds, NOW],
        );
    }

    it("covers every GuildObjectiveType with an evaluator", () => {
        expect(Object.keys(GUILD_OBJECTIVE_EVALUATORS).sort()).toEqual(
            Object.values(GuildObjectiveType).sort(),
        );
    });

    describe("finish_game", () => {
        it("counts distinct manual first finishes inside the window", async () => {
            const userId = await user();
            const gameA = await game();
            const gameB = await game();
            const gameC = await game();
            const gameBefore = await game();
            await entry(userId, gameA);
            await entry(userId, gameB);
            await entry(userId, gameC);
            await entry(userId, gameBefore);

            const finishedAt = new Date(NOW.getTime() + 10 * 60_000);
            await moveEntry(
                userId,
                gameA,
                CollectionEntryStatus.PLANNED,
                CollectionEntryStatus.FINISHED,
                finishedAt,
            );
            await moveEntry(
                userId,
                gameB,
                CollectionEntryStatus.PLANNED,
                CollectionEntryStatus.FINISHED,
                new Date(finishedAt.getTime() + 60_000),
            );
            // Imported finishes and finishes before acceptance never count.
            await moveEntry(
                userId,
                gameC,
                CollectionEntryStatus.PLANNED,
                CollectionEntryStatus.FINISHED,
                finishedAt,
                "import",
            );
            await moveEntry(
                userId,
                gameBefore,
                CollectionEntryStatus.PLANNED,
                CollectionEntryStatus.FINISHED,
                new Date(NOW.getTime() - AN_HOUR),
            );

            const contractId = await insertContract(userId, {
                objectiveType: GuildObjectiveType.FINISH_GAME,
                targetCount: 2,
            });
            await evaluate(userId, new Date(NOW.getTime() + 12 * 60_000));
            const ready = await contractOf(contractId);
            expect(ready.status).toBe(GuildContractStatus.READY_TO_CLAIM);
            expect(ready.progressCurrent).toBe(2);
        });

        it("enforces minTimeToBeatHours on evaluated finishes", async () => {
            const userId = await user();
            const longGame = await game();
            const shortGame = await game();
            await entry(userId, longGame);
            await entry(userId, shortGame);
            await timeToBeat(longGame, 40 * 60 * 60);
            await timeToBeat(shortGame, 10 * 60 * 60);

            const finishedAt = new Date(NOW.getTime() + 10 * 60_000);
            await moveEntry(
                userId,
                longGame,
                CollectionEntryStatus.PLANNED,
                CollectionEntryStatus.FINISHED,
                finishedAt,
            );
            await moveEntry(
                userId,
                shortGame,
                CollectionEntryStatus.PLANNED,
                CollectionEntryStatus.FINISHED,
                finishedAt,
            );

            const contractId = await insertContract(userId, {
                objectiveType: GuildObjectiveType.FINISH_GAME,
                criteria: { minTimeToBeatHours: 35 },
            });
            await evaluate(userId, new Date(NOW.getTime() + 2 * AN_HOUR));
            const contract = await contractOf(contractId);
            expect(contract.progressCurrent).toBe(1);
            expect(contract.status).toBe(GuildContractStatus.READY_TO_CLAIM);
        });
    });

    describe("write_review", () => {
        it("enforces the per-quest minReviewChars floor", async () => {
            const userId = await user();
            const gameA = await game();
            const gameB = await game();
            await entry(userId, gameA, {
                status: CollectionEntryStatus.FINISHED,
            });
            await entry(userId, gameB, {
                status: CollectionEntryStatus.FINISHED,
            });

            const contractId = await insertContract(userId, {
                objectiveType: GuildObjectiveType.WRITE_REVIEW,
                criteria: { minReviewChars: 200 },
            });
            await review(
                userId,
                gameA,
                new Date(NOW.getTime() + 5 * 60_000),
                "x".repeat(110),
            );
            await evaluate(userId, new Date(NOW.getTime() + 10 * 60_000));
            expect((await contractOf(contractId)).progressCurrent).toBe(0);

            await review(
                userId,
                gameB,
                new Date(NOW.getTime() + 15 * 60_000),
                "y".repeat(220),
            );
            await evaluate(userId, new Date(NOW.getTime() + 20 * 60_000));
            const ready = await contractOf(contractId);
            expect(ready.progressCurrent).toBe(1);
            expect(ready.status).toBe(GuildContractStatus.READY_TO_CLAIM);
        });
    });

    describe("log_playtime", () => {
        it("ignores an initial lifetime import without a baseline", async () => {
            const userId = await user();
            const gameA = await game();
            const platformId = await platform();
            await entry(userId, gameA);

            // First sync of a platform account: 120 hours with no prior observation.
            await observation(
                userId,
                gameA,
                platformId,
                432_000,
                new Date(NOW.getTime() + 5 * 60_000),
            );
            const contractId = await insertContract(userId, {
                objectiveType: GuildObjectiveType.LOG_PLAYTIME,
                targetCount: 240,
            });
            await evaluate(userId, new Date(NOW.getTime() + 10 * 60_000));
            expect((await contractOf(contractId)).progressCurrent).toBe(0);

            await observation(
                userId,
                gameA,
                platformId,
                435_600,
                new Date(NOW.getTime() + 15 * 60_000),
            );
            await evaluate(userId, new Date(NOW.getTime() + 20 * 60_000));
            const contract = await contractOf(contractId);
            expect(contract.progressCurrent).toBe(60);
            expect(contract.status).toBe(GuildContractStatus.ACTIVE);
        });

        it("counts distinct planned games over the per-game floor", async () => {
            const userId = await user();
            const gameA = await game();
            const gameB = await game();
            const gameC = await game();
            const platformId = await platform();
            await entry(userId, gameA, {
                status: CollectionEntryStatus.PLANNED,
            });
            await entry(userId, gameB, {
                status: CollectionEntryStatus.PLANNED,
            });
            await entry(userId, gameC, {
                status: CollectionEntryStatus.DROPPED,
            });

            const baselineAt = new Date(NOW.getTime() - 30 * 60_000);
            await observation(userId, gameA, platformId, 1_000, baselineAt);
            await observation(userId, gameB, platformId, 1_000, baselineAt);
            await observation(userId, gameC, platformId, 1_000, baselineAt);

            const firstFact = new Date(NOW.getTime() + 10 * 60_000);
            await observation(userId, gameA, platformId, 3_800, firstFact);
            await observation(userId, gameB, platformId, 2_700, firstFact);
            await observation(userId, gameC, platformId, 4_000, firstFact);

            const contractId = await insertContract(userId, {
                objectiveType: GuildObjectiveType.LOG_PLAYTIME,
                targetCount: 2,
                criteria: {
                    minPlaytimeSecondsPerGame: 2_700,
                    status: CollectionEntryStatus.PLANNED,
                },
            });
            await evaluate(userId, new Date(NOW.getTime() + 20 * 60_000));
            const first = await contractOf(contractId);
            // A has 2,800s, B 1,700s; the dropped game never qualifies.
            expect(first.progressCurrent).toBe(1);
            expect(first.status).toBe(GuildContractStatus.ACTIVE);

            await observation(
                userId,
                gameB,
                platformId,
                3_900,
                new Date(NOW.getTime() + 30 * 60_000),
            );
            await evaluate(userId, new Date(NOW.getTime() + 40 * 60_000));
            const ready = await contractOf(contractId);
            expect(ready.progressCurrent).toBe(2);
            expect(ready.status).toBe(GuildContractStatus.READY_TO_CLAIM);
        });
    });

    describe("play_distinct_days", () => {
        it("counts São Paulo days with at least 15 minutes and ignores lighter days", async () => {
            const userId = await user();
            const gameA = await game();
            const platformId = await platform();
            await entry(userId, gameA);

            await observation(
                userId,
                gameA,
                platformId,
                0,
                new Date(NOW.getTime() - 60_000),
            );
            const deltas: Array<[Date, number]> = [
                // 22:00 São Paulo on Jun 17.
                [new Date("2026-06-18T01:00:00Z"), 1_200],
                // Jun 18: 10 + 5 minutes.
                [new Date("2026-06-18T12:00:00Z"), 600],
                [new Date("2026-06-19T02:00:00Z"), 300],
                // Jun 19 and Jun 20.
                [new Date("2026-06-19T15:00:00Z"), 1_200],
                [new Date("2026-06-20T15:00:00Z"), 1_200],
                // Jun 21 stays under the 15 minute floor.
                [new Date("2026-06-21T15:00:00Z"), 600],
            ];
            let total = 0;
            for (const [createdAt, seconds] of deltas) {
                total += seconds;
                await observation(userId, gameA, platformId, total, createdAt);
            }

            const contractId = await insertContract(userId, {
                objectiveType: GuildObjectiveType.PLAY_DISTINCT_DAYS,
                targetCount: 4,
                expiresAt: new Date(NOW.getTime() + 7 * A_DAY),
            });
            await evaluate(userId, new Date("2026-06-22T12:00:00Z"));
            const contract = await contractOf(contractId);

            expect(contract.progressCurrent).toBe(4);
            expect(contract.status).toBe(GuildContractStatus.READY_TO_CLAIM);
        });
    });

    describe("daily_challenge", () => {
        it("ignores hinted, over-attempt, out-of-window and practice wins", async () => {
            const userId = await user();
            const contractId = await insertContract(userId, {
                objectiveType: GuildObjectiveType.DAILY_CHALLENGE,
                targetCount: 2,
                criteria: { requireNoDailyHint: true, maxDailyAttempts: 3 },
            });

            await dailyResult(userId, {
                status: DailyStatus.WON,
                hintAt: null,
                attempts: 2,
                finishedAt: new Date(NOW.getTime() + 10 * 60_000),
            });
            await dailyResult(userId, {
                status: DailyStatus.WON,
                hintAt: 1,
                attempts: 2,
                finishedAt: new Date(NOW.getTime() + 20 * 60_000),
            });
            await dailyResult(userId, {
                status: DailyStatus.WON,
                hintAt: null,
                attempts: 4,
                finishedAt: new Date(NOW.getTime() + 30 * 60_000),
            });
            await dailyResult(userId, {
                status: DailyStatus.WON,
                hintAt: null,
                attempts: 1,
                finishedAt: new Date(NOW.getTime() - AN_HOUR),
            });
            await dailyResult(userId, {
                status: DailyStatus.WON,
                hintAt: null,
                attempts: 3,
                finishedAt: new Date(NOW.getTime() + 40 * 60_000),
            });
            await source.query(
                `INSERT INTO daily_practice_round
                    (id, userId, mode, gameId, meta, guesses, hintAt, status, attempts, createdAt, finishedAt)
                 VALUES (?, ?, ?, ?, '{}', '[]', NULL, 'won', 1, ?, ?)`,
                [
                    randomUUID(),
                    userId,
                    DailyMode.COVER,
                    await game(),
                    NOW,
                    new Date(NOW.getTime() + 50 * 60_000),
                ],
            );

            await evaluate(userId, new Date(NOW.getTime() + 2 * AN_HOUR));
            const contract = await contractOf(contractId);

            expect(contract.progressCurrent).toBe(2);
            expect(contract.status).toBe(GuildContractStatus.READY_TO_CLAIM);
        });
    });

    describe("earn_game_achievements", () => {
        it("requires obtainedAt and createdAt inside the window", async () => {
            const userId = await user();
            const gameA = await game();
            const external = await externalGame(gameA);

            for (let index = 0; index < 50; index++) {
                await achievement(
                    userId,
                    external,
                    `old-${index}`,
                    new Date("2022-03-01T00:00:00Z"),
                    new Date("2022-03-01T00:00:00Z"),
                );
            }
            for (let index = 0; index < 6; index++) {
                const at = new Date(NOW.getTime() + (10 + index) * 60_000);
                await achievement(userId, external, `new-${index}`, at, at);
            }
            // Backfilled row: obtained at sync time, created long ago, or vice versa.
            await achievement(
                userId,
                external,
                "backfill",
                new Date(NOW.getTime() + 30 * 60_000),
                new Date("2022-03-01T00:00:00Z"),
            );

            const contractId = await insertContract(userId, {
                objectiveType: GuildObjectiveType.EARN_GAME_ACHIEVEMENTS,
                targetCount: 6,
            });
            await evaluate(userId, new Date(NOW.getTime() + AN_HOUR));
            const contract = await contractOf(contractId);

            expect(contract.progressCurrent).toBe(6);
            expect(contract.status).toBe(GuildContractStatus.READY_TO_CLAIM);
        });
    });

    describe("complete_game_100", () => {
        it("counts completed/platinum games with 5+ available achievements", async () => {
            const userId = await user();
            const gameA = await game();
            const gameB = await game();
            const gameC = await game();
            const gameD = await game();
            const externalA = await externalGame(gameA);
            const externalB = await externalGame(gameB);
            const externalC = await externalGame(gameC);
            const externalD = await externalGame(gameD);

            await completionStatus(userId, externalA, {
                isCompleted: true,
                totalAvailableAchievements: 30,
                completedAt: new Date(NOW.getTime() + 10 * 60_000),
            });
            await completionStatus(userId, externalB, {
                isPlatinumObtained: true,
                totalAvailableAchievements: 10,
                completedAt: new Date(NOW.getTime() + 20 * 60_000),
            });
            await completionStatus(userId, externalC, {
                isCompleted: true,
                totalAvailableAchievements: 4,
                completedAt: new Date(NOW.getTime() + 30 * 60_000),
            });
            await completionStatus(userId, externalD, {
                isCompleted: true,
                totalAvailableAchievements: 30,
                completedAt: new Date(NOW.getTime() - AN_HOUR),
            });

            const contractId = await insertContract(userId, {
                objectiveType: GuildObjectiveType.COMPLETE_GAME_100,
                targetCount: 2,
            });
            await evaluate(userId, new Date(NOW.getTime() + AN_HOUR));
            const contract = await contractOf(contractId);

            expect(contract.progressCurrent).toBe(2);
            expect(contract.status).toBe(GuildContractStatus.READY_TO_CLAIM);
        });
    });

    describe("curate_collection", () => {
        it("requires a described public collection and blocks 30-day repeats", async () => {
            const userId = await user();
            const games = await Promise.all(
                Array.from({ length: 10 }, () => game()),
            );
            const collectionX = await collection(userId, games.slice(0, 5), {
                updatedAt: new Date(NOW.getTime() + 10 * 60_000),
            });
            const collectionSmall = await collection(
                userId,
                games.slice(0, 4),
                { updatedAt: new Date(NOW.getTime() + 10 * 60_000) },
            );
            const collectionPrivate = await collection(
                userId,
                games.slice(0, 5),
                {
                    isPublic: false,
                    updatedAt: new Date(NOW.getTime() + 10 * 60_000),
                },
            );
            expect(collectionSmall).toBeDefined();
            expect(collectionPrivate).toBeDefined();

            const firstContract = await insertContract(userId, {
                objectiveType: GuildObjectiveType.CURATE_COLLECTION,
                criteria: { minCollectionEntries: 5 },
            });
            await evaluate(userId, new Date(NOW.getTime() + 20 * 60_000));
            const first = await contractOf(firstContract);
            expect(first.progressCurrent).toBe(1);
            expect(first.status).toBe(GuildContractStatus.READY_TO_CLAIM);

            // A completed contract credited Collection X 5 days ago.
            const priorId = randomUUID();
            await source.query(
                `INSERT INTO guild_contract
                    (id, profileUserId, category, templateKey, \`rank\`, xpReward, sealsReward,
                     objectiveType, criteria, targetGameId, progressCurrent, progressTarget,
                     status, claimPayload, acceptedAt, readyAt, claimedAt, expiresAt)
                 VALUES (?, ?, ?, 'cartographer', ?, 80, 0, ?, '{}', NULL, 1, 1, ?, ?, ?, ?, ?, NULL)`,
                [
                    priorId,
                    userId,
                    GuildCategory.GAMENODE,
                    GuildRank.E,
                    GuildObjectiveType.CURATE_COLLECTION,
                    GuildContractStatus.COMPLETED,
                    JSON.stringify({ creditedCollectionIds: [collectionX] }),
                    new Date(NOW.getTime() - 5 * A_DAY),
                    new Date(NOW.getTime() - 5 * A_DAY),
                    new Date(NOW.getTime() - 5 * A_DAY),
                ],
            );

            const secondContract = await insertContract(userId, {
                objectiveType: GuildObjectiveType.CURATE_COLLECTION,
                criteria: { minCollectionEntries: 5 },
                acceptedAt: new Date(NOW.getTime() + 30 * 60_000),
            });
            await source.query(
                "UPDATE collection SET updatedAt = ? WHERE id = ?",
                [new Date(NOW.getTime() + 40 * 60_000), collectionX],
            );
            await evaluate(userId, new Date(NOW.getTime() + AN_HOUR));
            expect((await contractOf(secondContract)).progressCurrent).toBe(0);

            const collectionY = await collection(userId, games.slice(5, 10), {
                updatedAt: new Date(NOW.getTime() + 50 * 60_000),
            });
            expect(collectionY).toBeDefined();
            await evaluate(userId, new Date(NOW.getTime() + 2 * AN_HOUR));
            const second = await contractOf(secondContract);
            expect(second.progressCurrent).toBe(1);
            expect(second.status).toBe(GuildContractStatus.READY_TO_CLAIM);
        });
    });

    describe("publish_post", () => {
        it("strips HTML before the length check and counts distinct games", async () => {
            const userId = await user();
            const gameA = await game();
            const gameB = await game();
            const gameC = await game();

            const contractId = await insertContract(userId, {
                objectiveType: GuildObjectiveType.PUBLISH_POST,
                targetCount: 2,
                criteria: { minPostChars: 80 },
            });
            await post(
                userId,
                gameA,
                "<p>Great game</p>",
                new Date(NOW.getTime() + 5 * 60_000),
            );
            await post(
                userId,
                gameB,
                "b".repeat(120),
                new Date(NOW.getTime() + 10 * 60_000),
            );
            await post(
                userId,
                gameC,
                "c".repeat(120),
                new Date(NOW.getTime() + 15 * 60_000),
                new Date(NOW.getTime() + 16 * 60_000),
            );
            await evaluate(userId, new Date(NOW.getTime() + 30 * 60_000));
            const first = await contractOf(contractId);
            expect(first.progressCurrent).toBe(1);
            expect(first.status).toBe(GuildContractStatus.ACTIVE);

            await post(
                userId,
                gameA,
                "a".repeat(100),
                new Date(NOW.getTime() + 40 * 60_000),
            );
            await evaluate(userId, new Date(NOW.getTime() + AN_HOUR));
            const ready = await contractOf(contractId);
            expect(ready.progressCurrent).toBe(2);
            expect(ready.status).toBe(GuildContractStatus.READY_TO_CLAIM);
        });
    });

    describe("triage_backlog", () => {
        it("only counts manual moves of games planned for 30+ days", async () => {
            const userId = await user();
            const longPlanned = new Date("2026-04-01T00:00:00Z");
            const gameA = await game();
            const gameB = await game();
            const gameC = await game();
            const gameD = await game();
            await entry(userId, gameA, {
                createdAt: longPlanned,
                plannedAt: longPlanned,
            });
            await entry(userId, gameB, {
                createdAt: new Date("2026-06-10T00:00:00Z"),
                plannedAt: new Date("2026-06-10T00:00:00Z"),
            });
            await entry(userId, gameC, {
                createdAt: longPlanned,
                plannedAt: longPlanned,
            });
            await entry(userId, gameD, {
                createdAt: longPlanned,
                plannedAt: longPlanned,
            });

            const factAt = new Date(NOW.getTime() + 10 * 60_000);
            await moveEntry(
                userId,
                gameA,
                CollectionEntryStatus.PLANNED,
                CollectionEntryStatus.FINISHED,
                factAt,
            );
            await moveEntry(
                userId,
                gameB,
                CollectionEntryStatus.PLANNED,
                CollectionEntryStatus.DROPPED,
                new Date(factAt.getTime() + 60_000),
            );
            await moveEntry(
                userId,
                gameC,
                CollectionEntryStatus.PLANNED,
                CollectionEntryStatus.PLAYING,
                new Date(factAt.getTime() + 120_000),
                "import",
            );
            await moveEntry(
                userId,
                gameD,
                CollectionEntryStatus.PLANNED,
                CollectionEntryStatus.PLAYING,
                new Date(factAt.getTime() + 180_000),
            );

            const contractId = await insertContract(userId, {
                objectiveType: GuildObjectiveType.TRIAGE_BACKLOG,
                targetCount: 2,
            });
            await evaluate(userId, new Date(NOW.getTime() + AN_HOUR));
            const contract = await contractOf(contractId);

            expect(contract.progressCurrent).toBe(2);
            expect(contract.status).toBe(GuildContractStatus.READY_TO_CLAIM);
        });
    });

    describe("bonus objectives", () => {
        async function finishQuests(
            userId: string,
            gameId: number,
            finishedAt: Date,
            bonus: GuildBonusObjective,
        ) {
            await entry(userId, gameId);
            const contractId = await insertContract(userId, {
                objectiveType: GuildObjectiveType.FINISH_GAME,
                targetGameId: gameId,
                expiresAt: new Date(NOW.getTime() + 7 * A_DAY),
                bonusObjective: bonus,
            });
            await moveEntry(
                userId,
                gameId,
                CollectionEntryStatus.PLANNED,
                CollectionEntryStatus.FINISHED,
                finishedAt,
            );
            return contractId;
        }

        it("marks finish_before_half_deadline only when finished early", async () => {
            const earlyUser = await user();
            const early = await finishQuests(
                earlyUser,
                await game(),
                new Date(NOW.getTime() + AN_HOUR),
                {
                    type: "finish_before_half_deadline",
                    bonusSeals: 15,
                    upgradeChestTier: true,
                },
            );
            await evaluate(earlyUser, new Date(NOW.getTime() + 2 * AN_HOUR));
            const earlyContract = await contractOf(early);
            expect(earlyContract.status).toBe(
                GuildContractStatus.READY_TO_CLAIM,
            );
            expect(earlyContract.bonusCompleted).toBe(true);

            const lateUser = await user();
            const late = await finishQuests(
                lateUser,
                await game(),
                new Date(NOW.getTime() + 6 * A_DAY),
                { type: "finish_before_half_deadline" },
            );
            await evaluate(
                lateUser,
                new Date(NOW.getTime() + 6 * A_DAY + AN_HOUR),
            );
            const lateContract = await contractOf(late);
            expect(lateContract.status).toBe(
                GuildContractStatus.READY_TO_CLAIM,
            );
            expect(lateContract.bonusCompleted).toBe(false);
        });

        it("marks also_write_review only with a long enough review", async () => {
            const withReviewUser = await user();
            const gameA = await game();
            const withReview = await finishQuests(
                withReviewUser,
                gameA,
                new Date(NOW.getTime() + AN_HOUR),
                { type: "also_write_review", minChars: 150 },
            );
            await review(
                withReviewUser,
                gameA,
                new Date(NOW.getTime() + 2 * AN_HOUR),
                "r".repeat(160),
            );
            await evaluate(
                withReviewUser,
                new Date(NOW.getTime() + 3 * AN_HOUR),
            );
            expect((await contractOf(withReview)).bonusCompleted).toBe(true);

            const noReviewUser = await user();
            const withoutReview = await finishQuests(
                noReviewUser,
                await game(),
                new Date(NOW.getTime() + AN_HOUR),
                { type: "also_write_review" },
            );
            await evaluate(noReviewUser, new Date(NOW.getTime() + 3 * AN_HOUR));
            const noReviewContract = await contractOf(withoutReview);
            expect(noReviewContract.status).toBe(
                GuildContractStatus.READY_TO_CLAIM,
            );
            expect(noReviewContract.bonusCompleted).toBe(false);
        });

        it("marks use_stale_backlog_game only for an untouched backlog pick", async () => {
            const staleUser = await user();
            const staleGame = await game();
            await entry(staleUser, staleGame, {
                createdAt: new Date(NOW.getTime() - 200 * A_DAY),
                plannedAt: new Date(NOW.getTime() - 200 * A_DAY),
            });
            const staleContractId = await insertContract(staleUser, {
                objectiveType: GuildObjectiveType.FINISH_GAME,
                targetGameId: staleGame,
                expiresAt: new Date(NOW.getTime() + 7 * A_DAY),
                bonusObjective: {
                    type: "use_stale_backlog_game",
                    staleDays: 180,
                },
            });
            await moveEntry(
                staleUser,
                staleGame,
                CollectionEntryStatus.PLANNED,
                CollectionEntryStatus.FINISHED,
                new Date(NOW.getTime() + AN_HOUR),
            );
            await evaluate(staleUser, new Date(NOW.getTime() + 2 * AN_HOUR));
            expect((await contractOf(staleContractId)).bonusCompleted).toBe(
                true,
            );

            const freshUser = await user();
            const freshGame = await game();
            await entry(freshUser, freshGame, {
                createdAt: new Date(NOW.getTime() - 10 * A_DAY),
                plannedAt: new Date(NOW.getTime() - 10 * A_DAY),
            });
            const freshContractId = await insertContract(freshUser, {
                objectiveType: GuildObjectiveType.FINISH_GAME,
                targetGameId: freshGame,
                expiresAt: new Date(NOW.getTime() + 7 * A_DAY),
                bonusObjective: {
                    type: "use_stale_backlog_game",
                    staleDays: 180,
                },
            });
            await moveEntry(
                freshUser,
                freshGame,
                CollectionEntryStatus.PLANNED,
                CollectionEntryStatus.FINISHED,
                new Date(NOW.getTime() + AN_HOUR),
            );
            await evaluate(freshUser, new Date(NOW.getTime() + 2 * AN_HOUR));
            const freshContract = await contractOf(freshContractId);
            expect(freshContract.status).toBe(
                GuildContractStatus.READY_TO_CLAIM,
            );
            expect(freshContract.bonusCompleted).toBe(false);
        });
    });

    describe("extended game criteria", () => {
        it("matches metadata, time-to-beat, library status and staleness", async () => {
            const userId = await user();
            const gameId = await game({
                firstReleaseDate: new Date("2015-05-05T00:00:00Z"),
            });
            const genreId = await taxonomy("game_genre", "Genre");
            const themeId = await taxonomy("game_theme", "Theme");
            const keywordId = await taxonomy("game_keyword", "Keyword");
            const franchiseId = await taxonomy("game_franchise", "Franchise");
            const platformId = await taxonomy("game_platform", "Platform");
            await source.query(
                "INSERT INTO game_genre (id, name) VALUES (32, 'Indie') ON DUPLICATE KEY UPDATE name = VALUES(name)",
            );
            await source.query(
                "INSERT INTO game_genres_game_genre (gameId, gameGenreId) VALUES (?, ?), (?, 32)",
                [gameId, genreId, gameId],
            );
            await source.query(
                "INSERT INTO game_themes_game_theme (gameId, gameThemeId) VALUES (?, ?)",
                [gameId, themeId],
            );
            await source.query(
                "INSERT INTO game_keywords_game_keyword (gameId, gameKeywordId) VALUES (?, ?)",
                [gameId, keywordId],
            );
            await source.query(
                "INSERT INTO game_franchises_game_franchise (gameId, gameFranchiseId) VALUES (?, ?)",
                [gameId, franchiseId],
            );
            await source.query(
                "INSERT INTO game_platform_games_game (gameId, gamePlatformId) VALUES (?, ?)",
                [gameId, platformId],
            );
            await entry(userId, gameId, {
                status: CollectionEntryStatus.PLAYING,
                createdAt: new Date(NOW.getTime() - 200 * A_DAY),
                plannedAt: new Date(NOW.getTime() - 200 * A_DAY),
            });
            await timeToBeat(gameId, 40 * 60 * 60);

            const ttbService = new GuildTimeToBeatService(
                source.getRepository(GameTimeToBeat),
                { getTimesToBeat: jest.fn().mockResolvedValue([]) } as any,
            );
            const matches = (
                criteria: GuildCriteria,
                options: Parameters<typeof gameMatchesGuildCriteria>[3] = {},
            ) =>
                gameMatchesGuildCriteria(source, gameId, criteria, {
                    now: NOW,
                    timeToBeat: ttbService,
                    userId,
                    ...options,
                });

            await expect(matches({ genreIds: [genreId] })).resolves.toBe(true);
            await expect(matches({ genreIds: [genreId + 999] })).resolves.toBe(
                false,
            );
            await expect(matches({ themeIds: [themeId] })).resolves.toBe(true);
            await expect(matches({ keywordIds: [keywordId] })).resolves.toBe(
                true,
            );
            await expect(
                matches({ franchiseIds: [franchiseId] }),
            ).resolves.toBe(true);
            await expect(matches({ platformIds: [platformId] })).resolves.toBe(
                true,
            );
            await expect(matches({ gameIds: [gameId] })).resolves.toBe(true);
            await expect(matches({ gameIds: [gameId + 999] })).resolves.toBe(
                false,
            );
            await expect(matches({ gameCategories: [0] })).resolves.toBe(true);
            await expect(matches({ gameCategories: [1] })).resolves.toBe(false);
            await expect(
                matches({ releaseYearMin: 2010, releaseYearMax: 2020 }),
            ).resolves.toBe(true);
            await expect(matches({ releaseYearMin: 2020 })).resolves.toBe(
                false,
            );
            await expect(matches({ releaseYearMax: 2010 })).resolves.toBe(
                false,
            );
            await expect(matches({ indieOnly: true })).resolves.toBe(true);
            await expect(
                matches({ minTimeToBeatHours: 35, maxTimeToBeatHours: 45 }),
            ).resolves.toBe(true);
            await expect(matches({ minTimeToBeatHours: 50 })).resolves.toBe(
                false,
            );
            await expect(matches({ maxTimeToBeatHours: 30 })).resolves.toBe(
                false,
            );
            await expect(
                matches(
                    {},
                    {
                        libraryStatuses: [CollectionEntryStatus.PLAYING],
                    },
                ),
            ).resolves.toBe(true);
            await expect(
                matches(
                    {},
                    {
                        libraryStatuses: [CollectionEntryStatus.PLANNED],
                    },
                ),
            ).resolves.toBe(false);
            await expect(matches({}, { staleDays: 180 })).resolves.toBe(true);
            await expect(matches({}, { staleDays: 400 })).resolves.toBe(false);
        });
    });
});
