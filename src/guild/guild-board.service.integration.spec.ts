import "reflect-metadata";
import { createHash, randomUUID } from "node:crypto";
import { DataSource, EntityManager } from "typeorm";
import { createAwardsTestDatabase } from "../../test/awards/awards-test-database";
import { CollectionEntryStatus } from "../collections/collections-entries/collections-entries.constants";
import { IGDBTimeToBeatPlaytime } from "../sync/igdb/igdb.types";
import { IgdbPlaytimeSyncService } from "../sync/igdb/playtime/igdb-playtime-sync.service";
import { RerollGuildBoardEntryResponseDto } from "./dto/guild-board.dto";
import { GameTimeToBeat } from "./entities/game-time-to-beat.entity";
import { GuildBoardService } from "./guild-board.service";
import { GuildContractEvaluatorService } from "./guild-contract-evaluator.service";
import { GuildContractRemindersService } from "./guild-contract-reminders.service";
import { GuildProceduralBoardService } from "./guild-procedural-board.service";
import { GuildSealsService } from "./guild-seals.service";
import { GuildScheduler } from "./guild.scheduler";
import { GuildTimeToBeatService } from "./guild-time-to-beat.service";
import { GUILD_SYSTEM_TEMPLATES } from "./guild-templates.constants";
import {
    DAY_MS,
    GuildBoardCycle,
    GuildCategory,
    GuildContractStatus,
    GuildConsumableKey,
    GuildEventStatus,
    GuildLocale,
    GuildObjectiveType,
    GuildRank,
    GuildRewardKind,
    guildRankAtLeast,
    seededOrder,
} from "./guild.constants";

const WEDNESDAY = new Date("2026-06-17T12:00:00Z");
const NEXT_WEDNESDAY = new Date("2026-06-24T12:00:00Z");
const WEEK_START = "2026-06-15";
const NEXT_WEEK_START = "2026-06-22";
const MONTH_KEY = "2026-06";
const MONTH_START = "2026-06-01";
const MONTH_RESET = new Date("2026-07-01T03:00:00Z");

const weekSeed = (userId: string, weekStart = WEEK_START) =>
    createHash("sha256").update(`${userId}:${weekStart}`).digest();

const monthlySeed = (userId: string, monthKey = MONTH_KEY) =>
    createHash("sha256").update(`${userId}:monthly:${monthKey}`).digest();

/** Templates of each rank-unlocked monthly pool. */
const monthlyPoolKeys = (rank: GuildRank) =>
    GUILD_SYSTEM_TEMPLATES.filter(
        (template) =>
            template.cycle === GuildBoardCycle.MONTHLY &&
            guildRankAtLeast(rank, template.minRank),
    );

/** Empty or single-game libraries cannot resolve these templates yet. */
const EMPTY_LIBRARY_WEEKLY_KEYS = [
    "weekend_sprint",
    "field_vigil",
    "campaign_rhythm",
];
const EMPTY_LIBRARY_GAMENODE_KEYS = [
    "quick_take",
    "on_duty_critic",
    "guild_oracle",
    "cartographer",
    "expedition_log",
];
const SHORT_GAME_WEEKLY_KEYS = [
    "short_caravan",
    "weekend_sprint",
    "field_vigil",
    "backlog_taste_test",
    "campaign_rhythm",
];
const SHORT_GAME_ONLY_KEYS = ["short_caravan", ...EMPTY_LIBRARY_WEEKLY_KEYS];

/** Rank D weekly/gamenode pools for a library that only unlocks hidden_gem. */
const RANK_D_FRESH_WEEKLY_KEYS = [
    "weekend_sprint",
    "double_feature",
    "field_vigil",
    "campaign_rhythm",
];
const RANK_D_FRESH_GAMENODE_KEYS = [
    "quick_take",
    "on_duty_critic",
    "deep_critic",
    "guild_oracle",
    "eagle_eye",
    "cartographer",
    "expedition_log",
];

const expectedWinner = (
    seed: Buffer,
    keys: readonly string[],
): string | undefined => seededOrder(seed, keys, (key) => key)[0];

const fixedUserId = (namespace: number, index: number) =>
    `${namespace.toString(16).padStart(4, "0")}${index
        .toString(16)
        .padStart(4, "0")}-0000-4000-8000-000000000000`;

/** First fixed user whose weekly seeds match, so rotation tests stay deterministic. */
function fixedUserMatching(
    namespace: number,
    predicate: (seed: Buffer, nextWeekSeed: Buffer) => boolean,
): string {
    for (let index = 0; ; index++) {
        const userId = fixedUserId(namespace, index);
        if (predicate(weekSeed(userId), weekSeed(userId, NEXT_WEEK_START)))
            return userId;
    }
}

interface HttpErrorLike {
    getStatus?: () => number;
    getResponse?: () => unknown;
}

async function rejection(promise: Promise<unknown>): Promise<HttpErrorLike> {
    try {
        await promise;
    } catch (error) {
        return error as HttpErrorLike;
    }
    throw new Error("Expected the promise to reject");
}

describe("GuildBoardService (integration)", () => {
    jest.setTimeout(120000);

    // Unique database so parallel suites never share or wipe the same schema.
    const database = `guild_test_board_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    let db: Awaited<ReturnType<typeof createAwardsTestDatabase>> | undefined;
    let source: DataSource;
    let service: GuildBoardService;
    let scheduler: GuildScheduler;
    const getTimesToBeat = jest.fn();
    let nextGameId = 7_000_000;
    let nextPlatformId = 8_000_000;
    let nextResourceId = 1_000_000;
    let nextExternalGameId = 5_000_000;

    const ttb = (
        gameId: number,
        overrides: Partial<IGDBTimeToBeatPlaytime> = {},
    ): IGDBTimeToBeatPlaytime => ({
        id: gameId,
        game_id: gameId,
        hastily: 10_800,
        normally: 21_600,
        completely: 43_200,
        count: 12,
        created_at: 0,
        updated_at: 0,
        checksum: "",
        ...overrides,
    });

    beforeAll(async () => {
        db = await createAwardsTestDatabase(database);
        source = db.source;
        const timeToBeatService = new GuildTimeToBeatService(
            source.getRepository(GameTimeToBeat),
            {
                getTimesToBeat,
            } as unknown as IgdbPlaytimeSyncService,
        );
        service = new GuildBoardService(
            source,
            timeToBeatService,
            new GuildProceduralBoardService(source, timeToBeatService),
            new GuildSealsService(source),
        );
        scheduler = new GuildScheduler(
            source,
            {
                expireOverdueContracts: async () => undefined,
            } as unknown as GuildContractEvaluatorService,
            {
                notifyExpiring: async () => undefined,
            } as unknown as GuildContractRemindersService,
            timeToBeatService,
        );

        const starterRewards = [
            ["badge_archaeologist", GuildRewardKind.BADGE, 0],
            ["weekly_chest", GuildRewardKind.WEEKLY_CHEST, 75],
            ["title_chronist", GuildRewardKind.TITLE, 0],
            ["chest_bronze", GuildRewardKind.CHEST_BRONZE, 0],
            ["chest_silver", GuildRewardKind.CHEST_SILVER, 0],
            ["chest_gold", GuildRewardKind.CHEST_GOLD, 0],
            ["chest_relic", GuildRewardKind.CHEST_RELIC, 0],
        ] as const;
        for (const [key, kind, chestBonusXp] of starterRewards) {
            await source.query(
                "INSERT IGNORE INTO guild_reward (id, `key`, kind, inChestPool, chestBonusXp, isActive) VALUES (?, ?, ?, 0, ?, 1)",
                [randomUUID(), key, kind, chestBonusXp],
            );
        }
    });

    afterAll(async () => {
        await db?.destroy();
    });

    beforeEach(async () => {
        getTimesToBeat.mockReset();
        getTimesToBeat.mockResolvedValue([]);
        await source.getRepository(GameTimeToBeat).clear();
    });

    async function user(userId: string = randomUUID()) {
        await source.query(
            "INSERT INTO profile (userId, username, createdAt) VALUES (?, ?, ?)",
            [
                userId,
                `u-${userId.slice(0, 8)}`,
                new Date("2025-01-02T03:04:05Z"),
            ],
        );
        await source.query("INSERT INTO library (userId) VALUES (?)", [userId]);
        return userId;
    }

    async function guildProfile(userId: string, xp: number) {
        await source.query(
            "INSERT INTO guild_profile (profileUserId, xp) VALUES (?, ?)",
            [userId, xp],
        );
    }

    async function game(name?: string, coverUrl?: string) {
        const id = nextGameId++;
        await source.query(
            "INSERT INTO game (id, name, slug) VALUES (?, ?, ?)",
            [id, name ?? `Game ${id}`, `game-${id}`],
        );
        if (coverUrl) {
            await source.query(
                "INSERT INTO game_cover (id, gameId, url) VALUES (?, ?, ?)",
                [id, id, coverUrl],
            );
        }
        return id;
    }

    async function entry(
        userId: string,
        gameId: number,
        values: {
            status?: CollectionEntryStatus;
            createdAt?: Date;
            plannedAt?: Date;
            startedAt?: Date;
        } = {},
    ) {
        const id = randomUUID();
        const createdAt = values.createdAt ?? new Date("2026-06-01T00:00:00Z");
        await source.query(
            `INSERT INTO collection_entry
                (id, gameId, libraryUserId, status, createdAt, updatedAt, plannedAt, startedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                gameId,
                userId,
                values.status ?? CollectionEntryStatus.PLANNED,
                createdAt,
                createdAt,
                values.plannedAt ?? null,
                values.startedAt ?? null,
            ],
        );
        return id;
    }

    async function finishHistory(userId: string, gameId: number, at: Date) {
        await source.query(
            `INSERT INTO collection_entry_status_history
                (libraryUserId, gameId, collectionEntryId, fromStatus, toStatus, source, occurredAt)
             VALUES (?, ?, NULL, NULL, ?, 'manual', ?)`,
            [userId, gameId, CollectionEntryStatus.FINISHED, at],
        );
    }

    async function playtime(userId: string, gameId: number, at: Date) {
        const platformId = nextPlatformId++;
        await source.query(
            "INSERT IGNORE INTO game_platform (id, name) VALUES (?, ?)",
            [platformId, "PC"],
        );
        await source.query(
            "INSERT INTO user_playtime (source, profileUserId, gameId, lastPlayedDate, platformId) VALUES ('steam', ?, ?, ?, ?)",
            [userId, gameId, at, platformId],
        );
    }

    async function timeToBeat(
        gameId: number,
        hours: number,
        fetchedAt = new Date(),
    ) {
        await source.query(
            `INSERT INTO game_time_to_beat
                (gameId, normallySeconds, hastilySeconds, completelySeconds, submitCount, fetchedAt)
             VALUES (?, ?, NULL, NULL, 1, ?)`,
            [gameId, Math.round(hours * 3_600), fetchedAt],
        );
    }

    async function resource(
        table: "game_genre" | "game_franchise",
        name: string,
    ) {
        const id = nextResourceId++;
        await source.query(`INSERT INTO ${table} (id, name) VALUES (?, ?)`, [
            id,
            name,
        ]);
        return id;
    }

    async function linkGenre(gameId: number, genreId: number) {
        await source.query(
            "INSERT INTO game_genres_game_genre (gameId, gameGenreId) VALUES (?, ?)",
            [gameId, genreId],
        );
    }

    async function linkFranchise(gameId: number, franchiseId: number) {
        await source.query(
            "INSERT INTO game_franchises_game_franchise (gameId, gameFranchiseId) VALUES (?, ?)",
            [gameId, franchiseId],
        );
    }

    async function syncedAchievement(userId: string, gameId: number) {
        const externalGameId = nextExternalGameId++;
        await source.query(
            "INSERT INTO game_external_game (id, uid, gameId) VALUES (?, ?, ?)",
            [externalGameId, `ext-${externalGameId}`, gameId],
        );
        await source.query(
            `INSERT INTO obtained_game_achievement
                (externalAchievementId, profileUserId, externalGameId, obtainedAt, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, NOW(), NOW())`,
            ["achievement-1", userId, externalGameId, new Date("2026-06-01")],
        );
    }

    /** Library that makes every Monthly Expedition template eligible. */
    async function allMonthlyTemplatesUser(userId: string) {
        const genreId = await resource("game_genre", "RPG");
        const franchiseId = await resource("game_franchise", "Saga");
        const ancient = await game("Ancient RPG");
        const legendary = await game("Legendary RPG");
        const third = await game("Saga RPG");
        await timeToBeat(legendary, 70);
        for (const gameId of [ancient, legendary, third]) {
            await linkGenre(gameId, genreId);
            await linkFranchise(gameId, franchiseId);
        }
        await entry(userId, ancient, {
            plannedAt: new Date("2023-05-01T00:00:00Z"),
            createdAt: new Date("2023-05-01T00:00:00Z"),
        });
        await entry(userId, legendary, {
            plannedAt: new Date("2026-05-18T00:00:00Z"),
            createdAt: new Date("2026-05-18T00:00:00Z"),
        });
        await entry(userId, third, {
            plannedAt: new Date("2026-05-28T00:00:00Z"),
            createdAt: new Date("2026-05-28T00:00:00Z"),
        });
        await syncedAchievement(userId, third);
        return { ancient, legendary };
    }

    async function event(values: {
        startsAt: Date;
        endsAt: Date;
        rank?: GuildRank;
        xpReward?: number;
        status?: GuildEventStatus;
        rewardId?: string | null;
        title?: string;
        description?: string;
        objectiveType?: GuildObjectiveType;
        targetCount?: number;
        translations?: Array<{
            locale: GuildLocale;
            title: string;
            description: string;
        }>;
    }) {
        const id = randomUUID();
        await source.query(
            `INSERT INTO guild_event
                (id, slug, title, description, \`rank\`, xpReward, objectiveType, targetCount, criteria, rewardId, startsAt, endsAt, status, publishedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?)`,
            [
                id,
                `slug-${id}`,
                values.title ?? "Curated event",
                values.description ?? "Event description",
                values.rank ?? GuildRank.C,
                values.xpReward ?? 200,
                values.objectiveType ?? GuildObjectiveType.FINISH_GAME,
                values.targetCount ?? 1,
                values.rewardId ?? null,
                values.startsAt,
                values.endsAt,
                values.status ?? GuildEventStatus.PUBLISHED,
                new Date("2026-01-01T00:00:00Z"),
            ],
        );
        for (const translation of values.translations ?? []) {
            await source.query(
                `INSERT INTO guild_event_translation
                    (eventId, locale, title, description)
                 VALUES (?, ?, ?, ?)`,
                [
                    id,
                    translation.locale,
                    translation.title,
                    translation.description,
                ],
            );
        }
        return id;
    }

    async function contract(
        userId: string,
        values: {
            boardEntryId?: string | null;
            eventId?: string | null;
            status: GuildContractStatus;
        },
    ) {
        const id = randomUUID();
        await source.query(
            `INSERT INTO guild_contract
                (id, profileUserId, boardEntryId, eventId, category, templateKey, \`rank\`, xpReward, objectiveType, criteria, acceptedAt, status)
             VALUES (?, ?, ?, ?, ?, ?, 'B', 250, 'finish_game', '{}', ?, ?)`,
            [
                id,
                userId,
                values.boardEntryId ?? null,
                values.eventId ?? null,
                values.eventId ? GuildCategory.EVENT : GuildCategory.LIBRARY,
                values.eventId ? null : "forgotten_relic",
                new Date("2026-06-15T00:00:00Z"),
                values.status,
            ],
        );
        return id;
    }

    async function rewardId(key: string) {
        const [row] = await source.query(
            "SELECT id FROM guild_reward WHERE `key` = ?",
            [key],
        );
        return row.id as string;
    }

    const weeklyQuestOf = (board: { quests: Array<any> }) =>
        board.quests
            .filter(
                (quest) =>
                    quest.sourceType === "board_entry" &&
                    quest.category === GuildCategory.WEEKLY,
            )
            .at(-1);

    const gamenodeQuestOf = (board: { quests: Array<any> }) =>
        board.quests
            .filter(
                (quest) =>
                    quest.sourceType === "board_entry" &&
                    quest.category === GuildCategory.GAMENODE,
            )
            .at(-1);

    const libraryQuestOf = (board: { quests: Array<any> }) =>
        board.quests.find(
            (quest) =>
                quest.sourceType === "board_entry" &&
                quest.category === GuildCategory.LIBRARY,
        );

    it("returns the same persisted quests for repeated reads in the same week", async () => {
        const userId = await user();
        const gameId = await game("Stable backlog");
        await entry(userId, gameId, {
            plannedAt: new Date("2023-05-01T00:00:00Z"),
            createdAt: new Date("2023-05-01T00:00:00Z"),
        });

        const first = await service.getBoard(userId, { now: WEDNESDAY });
        const second = await service.getBoard(userId, { now: WEDNESDAY });

        expect(first.weekStart).toBe("2026-06-15");
        expect(first.nextRefreshAt).toEqual(new Date("2026-06-22T03:00:00Z"));
        expect(second.quests).toEqual(first.quests);
        const entries = first.quests.filter(
            (quest) => quest.sourceType === "board_entry",
        );
        expect(entries).toHaveLength(3);
        for (const quest of entries)
            expect(quest).toMatchObject({
                cycle: GuildBoardCycle.WEEKLY,
                rerollCount: 0,
            });
        expect(entries.every((quest) => quest.sealsReward > 0)).toBe(true);
        expect(first).toMatchObject({
            rerollsRemaining: 0,
            rerollChartersOwned: 0,
            monthlyExpeditionLocked: true,
        });
        expect(
            await source.query(
                "SELECT COUNT(*) AS total FROM guild_board_entry WHERE profileUserId = ?",
                [userId],
            ),
        ).toEqual([{ total: 3 }]);
    });

    it("advances the week and generates new entries after Monday 00:00 São Paulo", async () => {
        const userId = await user();
        await entry(userId, await game(), {
            plannedAt: new Date("2023-05-01T00:00:00Z"),
            createdAt: new Date("2023-05-01T00:00:00Z"),
        });

        const first = await service.getBoard(userId, { now: WEDNESDAY });
        const next = await service.getBoard(userId, {
            now: new Date("2026-06-24T12:00:00Z"),
        });

        expect(first.weekStart).toBe("2026-06-15");
        expect(next.weekStart).toBe("2026-06-22");
        expect(next.nextRefreshAt).toEqual(new Date("2026-06-29T03:00:00Z"));

        const firstIds = first.quests
            .map((quest) => quest.boardEntryId)
            .filter((id): id is string => id !== null);
        const nextIds = next.quests
            .map((quest) => quest.boardEntryId)
            .filter((id): id is string => id !== null);
        expect(firstIds).toHaveLength(3);
        expect(nextIds).toHaveLength(3);
        expect(nextIds.some((id) => firstIds.includes(id))).toBe(false);

        const rows = await source.query(
            "SELECT weekStart FROM guild_board_entry WHERE profileUserId = ? ORDER BY weekStart ASC",
            [userId],
        );
        expect(rows).toHaveLength(6);
        expect([
            ...new Set(rows.map((row: any) => String(row.weekStart))),
        ]).toEqual(["2026-06-15", "2026-06-22"]);
    });

    it("falls back to weekly/gamenode slots and keeps active events for an empty library", async () => {
        const userId = await user();
        const eventId = await event({
            startsAt: new Date("2026-06-16T00:00:00Z"),
            endsAt: new Date("2026-06-23T00:00:00Z"),
        });

        const board = await service.getBoard(userId, { now: WEDNESDAY });
        const entries = board.quests.filter(
            (quest) => quest.sourceType === "board_entry",
        );

        expect(entries).toHaveLength(3);
        expect(libraryQuestOf(board)).toBeUndefined();
        expect(
            entries.filter((quest) => quest.category === GuildCategory.WEEKLY)
                .length,
        ).toBeGreaterThanOrEqual(1);
        expect(
            entries.filter((quest) => quest.category === GuildCategory.GAMENODE)
                .length,
        ).toBeGreaterThanOrEqual(1);
        expect(board.quests.some((quest) => quest.eventId === eventId)).toBe(
            true,
        );
    });

    it("rotates library, weekly and GameNode slots across the expanded catalog by rank", async () => {
        // A fresh planned game without genre/franchise/release data only unlocks
        // hidden_gem (Rank D library template) among the library-DNA quests.
        const rankD = await user(fixedUserId(1, 0));
        await guildProfile(rankD, 300);
        const hiddenGem = await game("Obscure fresh backlog");
        await entry(rankD, hiddenGem, {
            createdAt: new Date("2026-06-01T00:00:00Z"),
        });

        const rankDBoard = await service.getBoard(rankD, { now: WEDNESDAY });
        const rankDLibrary = libraryQuestOf(rankDBoard);
        expect(rankDLibrary).toMatchObject({
            templateKey: "hidden_gem",
            rank: GuildRank.C,
            candidateGames: [expect.objectContaining({ gameId: hiddenGem })],
        });
        expect(weeklyQuestOf(rankDBoard)?.templateKey).toBe(
            expectedWinner(weekSeed(rankD), RANK_D_FRESH_WEEKLY_KEYS),
        );
        expect(gamenodeQuestOf(rankDBoard)?.templateKey).toBe(
            expectedWinner(weekSeed(rankD), RANK_D_FRESH_GAMENODE_KEYS),
        );
        expect(RANK_D_FRESH_WEEKLY_KEYS).toContain("double_feature");
        expect(RANK_D_FRESH_GAMENODE_KEYS).toContain("deep_critic");

        // The same shape of library stays below the Rank D gates.
        const rankE = await user(fixedUserId(1, 1));
        const sameLibrary = await game("Obscure fresh backlog E");
        await entry(rankE, sameLibrary, {
            createdAt: new Date("2026-06-01T00:00:00Z"),
        });
        const rankEBoard = await service.getBoard(rankE, { now: WEDNESDAY });
        expect(libraryQuestOf(rankEBoard)).toBeUndefined();
        expect(weeklyQuestOf(rankEBoard)?.templateKey).toBe(
            expectedWinner(weekSeed(rankE), EMPTY_LIBRARY_WEEKLY_KEYS),
        );
        expect(gamenodeQuestOf(rankEBoard)?.templateKey).toBe(
            expectedWinner(weekSeed(rankE), EMPTY_LIBRARY_GAMENODE_KEYS),
        );
    });

    it("rotates weekly and gamenode slots across weeks while the same week stays stable", async () => {
        const gamenodeUser = await user(
            fixedUserMatching(
                2,
                (seed, next) =>
                    expectedWinner(seed, EMPTY_LIBRARY_GAMENODE_KEYS) !==
                    expectedWinner(next, EMPTY_LIBRARY_GAMENODE_KEYS),
            ),
        );
        const weeklyUser = await user(
            fixedUserMatching(
                3,
                (seed, next) =>
                    expectedWinner(seed, EMPTY_LIBRARY_WEEKLY_KEYS) !==
                    expectedWinner(next, EMPTY_LIBRARY_WEEKLY_KEYS),
            ),
        );

        const templateOf = async (userId: string, now: Date) => {
            const board = await service.getBoard(userId, { now });
            return {
                gamenode: gamenodeQuestOf(board)?.templateKey,
                weekly: weeklyQuestOf(board)?.templateKey,
            };
        };
        const gamenodeOf = async (userId: string, now: Date) =>
            (await templateOf(userId, now)).gamenode;
        const weeklyOf = async (userId: string, now: Date) =>
            (await templateOf(userId, now)).weekly;

        const gamenodeFirst = await gamenodeOf(gamenodeUser, WEDNESDAY);
        const weeklyFirst = await weeklyOf(weeklyUser, WEDNESDAY);
        expect(gamenodeFirst).toBe(
            expectedWinner(weekSeed(gamenodeUser), EMPTY_LIBRARY_GAMENODE_KEYS),
        );
        expect(weeklyFirst).toBe(
            expectedWinner(weekSeed(weeklyUser), EMPTY_LIBRARY_WEEKLY_KEYS),
        );
        // Same-week reloads keep the persisted templates.
        expect(
            await gamenodeOf(gamenodeUser, new Date("2026-06-19T12:00:00Z")),
        ).toBe(gamenodeFirst);
        expect(
            await weeklyOf(weeklyUser, new Date("2026-06-19T12:00:00Z")),
        ).toBe(weeklyFirst);
        // A different week seed rotates both slots.
        expect(await gamenodeOf(gamenodeUser, NEXT_WEDNESDAY)).not.toBe(
            gamenodeFirst,
        );
        expect(await weeklyOf(weeklyUser, NEXT_WEDNESDAY)).not.toBe(
            weeklyFirst,
        );
    });

    it("builds a forgotten_relic quest with enriched stale-backlog chips", async () => {
        const userId = await user(
            fixedUserMatching(
                4,
                (seed) =>
                    expectedWinner(seed, ["recent_dust", "forgotten_relic"]) ===
                    "forgotten_relic",
            ),
        );
        const relicGame = await game(
            "Hollow Knight",
            "//images.igdb.com/igdb/image/upload/t_thumb/co1.jpg",
        );
        const playedGame = await game("Recently played relic");
        await entry(userId, relicGame, {
            plannedAt: new Date("2023-05-01T00:00:00Z"),
            createdAt: new Date("2023-05-01T00:00:00Z"),
        });
        await entry(userId, playedGame, {
            plannedAt: new Date("2023-04-01T00:00:00Z"),
            createdAt: new Date("2023-04-01T00:00:00Z"),
        });
        await playtime(userId, playedGame, new Date("2026-05-01T00:00:00Z"));

        const board = await service.getBoard(userId, { now: WEDNESDAY });
        const relic = board.quests.find(
            (quest) => quest.templateKey === "forgotten_relic",
        );

        expect(relic).toMatchObject({
            sourceType: "board_entry",
            category: GuildCategory.LIBRARY,
            cycle: GuildBoardCycle.WEEKLY,
            sealsReward: 60,
            requiresTargetGame: true,
            contractDurationDays: 21,
            reward: { key: "badge_archaeologist" },
        });
        expect(relic?.meta?.staleDays).toBeGreaterThanOrEqual(365);
        expect(relic?.candidateGames).toEqual([
            {
                gameId: relicGame,
                name: "Hollow Knight",
                slug: `game-${relicGame}`,
                coverUrl:
                    "https://images.igdb.com/igdb/image/upload/t_cover_big/co1.jpg",
                sinceYear: 2023,
            },
        ]);
    });

    it("uses cached short games for short_caravan and degrades without short candidates", async () => {
        const userId = await user(
            fixedUserMatching(
                5,
                (seed) =>
                    expectedWinner(seed, SHORT_GAME_WEEKLY_KEYS) ===
                    "short_caravan",
            ),
        );
        const sixHourGame = await game("Six hour game");
        const sevenHalfHourGame = await game("Seven and a half hour game");
        await entry(userId, sixHourGame, {
            createdAt: new Date("2026-06-02T00:00:00Z"),
        });
        await entry(userId, sevenHalfHourGame, {
            createdAt: new Date("2026-06-01T00:00:00Z"),
        });
        getTimesToBeat.mockResolvedValueOnce([
            ttb(sixHourGame, { normally: 6 * 3_600, hastily: 2 * 3_600 }),
            ttb(sevenHalfHourGame, {
                normally: undefined,
                hastily: 7.5 * 3_600,
            }),
        ]);

        const shortBoard = await service.getBoard(userId, { now: WEDNESDAY });
        const shortQuest = shortBoard.quests.find(
            (quest) => quest.templateKey === "short_caravan",
        );
        expect(shortQuest?.contractDurationDays).toBe(7);
        expect(shortQuest?.candidateGames).toHaveLength(2);
        expect(shortQuest?.candidateGames).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    gameId: sixHourGame,
                    estimatedHours: 6,
                    name: "Six hour game",
                }),
                expect.objectContaining({
                    gameId: sevenHalfHourGame,
                    estimatedHours: 8,
                    name: "Seven and a half hour game",
                }),
            ]),
        );

        const degradedUser = await user();
        await entry(degradedUser, await game("Uncached game"), {
            createdAt: new Date("2026-06-01T00:00:00Z"),
        });
        getTimesToBeat.mockRejectedValueOnce(new Error("IGDB timeout"));

        const degradedBoard = await service.getBoard(degradedUser, {
            now: WEDNESDAY,
        });
        expect(
            degradedBoard.quests.some(
                (quest) => quest.templateKey === "short_caravan",
            ),
        ).toBe(false);
        expect(
            degradedBoard.quests.filter(
                (quest) => quest.sourceType === "board_entry",
            ),
        ).toHaveLength(3);
    });

    it("keeps previously finished games out of every candidate chip", async () => {
        const userId = await user(
            fixedUserMatching(
                6,
                (seed) =>
                    expectedWinner(seed, SHORT_GAME_ONLY_KEYS) ===
                    "short_caravan",
            ),
        );
        const staleFinished = await game("Finished relic");
        const playingFinished = await game("Finished replay");
        const shortFinished = await game("Finished short game");
        const shortEligible = await game("Eligible short game");
        await entry(userId, staleFinished, {
            status: CollectionEntryStatus.DROPPED,
            plannedAt: new Date("2023-05-01T00:00:00Z"),
            createdAt: new Date("2023-05-01T00:00:00Z"),
        });
        await entry(userId, playingFinished, {
            status: CollectionEntryStatus.PLAYING,
            startedAt: new Date("2026-06-10T00:00:00Z"),
        });
        await entry(userId, shortFinished, {
            createdAt: new Date("2026-06-02T00:00:00Z"),
        });
        await entry(userId, shortEligible, {
            createdAt: new Date("2026-06-01T00:00:00Z"),
        });
        for (const gameId of [staleFinished, playingFinished, shortFinished])
            await finishHistory(
                userId,
                gameId,
                new Date("2026-05-01T00:00:00Z"),
            );
        getTimesToBeat.mockResolvedValueOnce([
            ttb(shortEligible, { normally: 6 * 3_600 }),
            ttb(shortFinished, { normally: 6 * 3_600 }),
        ]);

        const board = await service.getBoard(userId, { now: WEDNESDAY });
        const boardEntries = board.quests.filter(
            (quest) => quest.sourceType === "board_entry",
        );

        expect(libraryQuestOf(board)).toBeUndefined();
        const shortQuest = boardEntries.find(
            (quest) => quest.templateKey === "short_caravan",
        );
        expect(shortQuest?.candidateGames.map((game) => game.gameId)).toEqual([
            shortEligible,
        ]);
        const chips = boardEntries.flatMap((quest) =>
            quest.candidateGames.map((game) => game.gameId),
        );
        for (const gameId of [staleFinished, playingFinished, shortFinished])
            expect(chips).not.toContain(gameId);
        expect(boardEntries).toHaveLength(3);
        expect(await service.getOpenBoardCount(userId, WEDNESDAY)).toBe(
            board.quests.length,
        );
    });

    it("attaches deterministic, compatible optional bonus objectives", async () => {
        const userId = await user();
        await entry(userId, await game("Bonus relic"), {
            plannedAt: new Date("2023-05-01T00:00:00Z"),
            createdAt: new Date("2023-05-01T00:00:00Z"),
        });
        const first = await service.getBoard(userId, { now: WEDNESDAY });
        const second = await service.getBoard(userId, { now: WEDNESDAY });
        expect(second.quests).toEqual(first.quests);

        const compatibleTypes: Record<string, string[]> = {
            [GuildObjectiveType.FINISH_GAME]: [
                "also_write_review",
                "finish_before_half_deadline",
                "use_stale_backlog_game",
            ],
            [GuildObjectiveType.WRITE_REVIEW]: ["finish_before_half_deadline"],
        };
        for (const quest of first.quests.filter(
            (item) => item.sourceType === "board_entry",
        )) {
            const types = compatibleTypes[quest.objectiveType];
            if (!types) {
                expect(quest.bonusObjective).toBeNull();
                continue;
            }
            if (quest.bonusObjective !== null)
                expect(types).toContain(quest.bonusObjective.type);
        }

        // Roughly half of the compatible slots carry one across many seeds.
        let compatible = 0;
        let withBonus = 0;
        for (let index = 0; index < 12; index++) {
            const member = await user(fixedUserId(10, index));
            await entry(member, await game(`Bonus pool ${index}`), {
                plannedAt: new Date("2023-05-01T00:00:00Z"),
                createdAt: new Date("2023-05-01T00:00:00Z"),
            });
            const board = await service.getBoard(member, { now: WEDNESDAY });
            for (const quest of board.quests.filter(
                (item) => item.sourceType === "board_entry",
            ))
                if (compatibleTypes[quest.objectiveType]) {
                    compatible++;
                    if (quest.bonusObjective !== null) withBonus++;
                }
        }
        expect(compatible).toBeGreaterThan(10);
        expect(withBonus).toBeGreaterThan(0);
        expect(withBonus).toBeLessThan(compatible);

        const persisted = await source.query(
            "SELECT bonusObjective FROM guild_board_entry WHERE profileUserId = ? AND bonusObjective IS NOT NULL LIMIT 1",
            [userId],
        );
        if (persisted.length > 0) {
            const stored = persisted[0].bonusObjective;
            const parsed =
                typeof stored === "string" ? JSON.parse(stored) : stored;
            const quest = first.quests.find(
                (item) => item.bonusObjective?.type === parsed.type,
            );
            expect(quest?.bonusObjective).toMatchObject(parsed);
        }
    });

    it("persists the Monthly Expedition from Rank C and locks it below", async () => {
        const lockedUser = await user();
        await guildProfile(lockedUser, 300);
        const lockedBoard = await service.getBoard(lockedUser, {
            now: WEDNESDAY,
        });
        expect(lockedBoard.monthlyExpeditionLocked).toBe(true);
        expect(
            lockedBoard.quests.some(
                (quest) => quest.cycle === GuildBoardCycle.MONTHLY,
            ),
        ).toBe(false);
        expect(
            await source.query(
                "SELECT COUNT(*) AS total FROM guild_board_entry WHERE profileUserId = ? AND cycle = 'monthly'",
                [lockedUser],
            ),
        ).toEqual([{ total: 0 }]);

        const userId = await user();
        await guildProfile(userId, 800);
        const board = await service.getBoard(userId, { now: WEDNESDAY });
        expect(board.monthlyExpeditionLocked).toBe(false);
        const monthly = board.quests.find(
            (quest) => quest.cycle === GuildBoardCycle.MONTHLY,
        );
        expect(monthly).toMatchObject({
            sourceType: "board_entry",
            category: GuildCategory.MONTHLY,
            cycle: GuildBoardCycle.MONTHLY,
            rank: GuildRank.A,
            rerollCount: 0,
            expiresAt: MONTH_RESET,
        });
        expect(
            board.quests.filter((quest) => quest.sourceType === "board_entry"),
        ).toHaveLength(4);

        const rows = await source.query(
            "SELECT slotIndex, periodKey, weekStart, expiresAt FROM guild_board_entry WHERE profileUserId = ? AND cycle = 'monthly'",
            [userId],
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            slotIndex: 3,
            periodKey: MONTH_KEY,
            weekStart: MONTH_START,
        });
        expect(new Date(rows[0].expiresAt)).toEqual(MONTH_RESET);

        // Stays stable across the month and counts as an open quest.
        const later = await service.getBoard(userId, {
            now: new Date("2026-06-25T12:00:00Z"),
        });
        expect(
            later.quests.find(
                (quest) => quest.cycle === GuildBoardCycle.MONTHLY,
            )?.boardEntryId,
        ).toBe(monthly?.boardEntryId);
        expect(await service.getOpenBoardCount(userId, WEDNESDAY)).toBe(
            board.quests.length,
        );

        // A new São Paulo month persists a fresh expedition.
        const july = await service.getBoard(userId, {
            now: new Date("2026-07-15T12:00:00Z"),
        });
        const julyMonthly = july.quests.find(
            (quest) => quest.cycle === GuildBoardCycle.MONTHLY,
        );
        expect(julyMonthly?.boardEntryId).not.toBe(monthly?.boardEntryId);
        const julyRows = await source.query(
            "SELECT periodKey, weekStart FROM guild_board_entry WHERE profileUserId = ? AND cycle = 'monthly' ORDER BY periodKey ASC",
            [userId],
        );
        expect(julyRows.map((row: any) => row.periodKey)).toEqual([
            "2026-06",
            "2026-07",
        ]);
        expect(julyRows[1].weekStart).toBe("2026-07-01");
    });

    it("adds Rank S expeditions to Rank A pools and keeps Rank C on Rank A", async () => {
        const rankSPool = monthlyPoolKeys(GuildRank.A);
        let rankAUserId = "";
        for (let index = 0; index < 2_000; index++) {
            const candidate = fixedUserId(11, index);
            const winner = seededOrder(
                monthlySeed(candidate),
                rankSPool,
                (template) => template.key,
            )[0];
            if (winner.rank === GuildRank.S) {
                rankAUserId = candidate;
                break;
            }
        }
        expect(rankAUserId).not.toBe("");

        await user(rankAUserId);
        await guildProfile(rankAUserId, 4_000);
        await allMonthlyTemplatesUser(rankAUserId);
        const rankABoard = await service.getBoard(rankAUserId, {
            now: WEDNESDAY,
        });
        const rankAMonthly = rankABoard.quests.find(
            (quest) => quest.cycle === GuildBoardCycle.MONTHLY,
        );
        expect(rankAMonthly?.rank).toBe(GuildRank.S);
        expect(rankAMonthly?.templateKey).toBe(
            seededOrder(
                monthlySeed(rankAUserId),
                rankSPool,
                (template) => template.key,
            )[0].key,
        );

        const rankCUserId = fixedUserId(12, 0);
        await user(rankCUserId);
        await guildProfile(rankCUserId, 800);
        await allMonthlyTemplatesUser(rankCUserId);
        const rankCBoard = await service.getBoard(rankCUserId, {
            now: WEDNESDAY,
        });
        const rankCMonthly = rankCBoard.quests.find(
            (quest) => quest.cycle === GuildBoardCycle.MONTHLY,
        );
        const rankCPool = monthlyPoolKeys(GuildRank.C);
        expect(rankCMonthly?.rank).toBe(GuildRank.A);
        expect(rankCMonthly?.templateKey).toBe(
            seededOrder(
                monthlySeed(rankCUserId),
                rankCPool,
                (template) => template.key,
            )[0].key,
        );
    });

    it("spends the single Rank D free weekly reroll in place", async () => {
        const userId = await user();
        await guildProfile(userId, 300);
        const board = await service.getBoard(userId, { now: WEDNESDAY });
        expect(board.rerollsRemaining).toBe(1);
        const target = weeklyQuestOf(board);

        const result: RerollGuildBoardEntryResponseDto =
            await service.rerollEntry(userId, target.boardEntryId, WEDNESDAY);

        expect(result.consumableUsed).toBeNull();
        expect(result.rerollsRemaining).toBe(0);
        expect(result.rerollChartersOwned).toBe(0);
        expect(result.quest.boardEntryId).toBe(target.boardEntryId);
        expect(result.quest.rerollCount).toBe(1);
        expect(result.quest.templateKey).not.toBe(target.templateKey);

        const [profile] = await source.query(
            "SELECT freeRerollWeekStart, freeRerollsUsedThisWeek FROM guild_profile WHERE profileUserId = ?",
            [userId],
        );
        expect(profile.freeRerollWeekStart).toBe(WEEK_START);
        expect(profile.freeRerollsUsedThisWeek).toBe(1);

        const refreshed = await service.getBoard(userId, { now: WEDNESDAY });
        expect(refreshed.rerollsRemaining).toBe(0);
        expect(
            refreshed.quests.find(
                (quest) => quest.boardEntryId === target.boardEntryId,
            )?.templateKey,
        ).toBe(result.quest.templateKey);
        expect(
            await source.query(
                "SELECT COUNT(*) AS total FROM guild_board_entry WHERE profileUserId = ? AND weekStart = ?",
                [userId, WEEK_START],
            ),
        ).toEqual([{ total: 3 }]);
    });

    it("grants Rank S two free weekly rerolls before charging a reroll_charter", async () => {
        const userId = await user();
        await guildProfile(userId, 7_500);
        await source.query(
            "INSERT INTO guild_consumable_inventory (profileUserId, consumableKey, quantity) VALUES (?, ?, 2)",
            [userId, GuildConsumableKey.REROLL_CHARTER],
        );
        const board = await service.getBoard(userId, { now: WEDNESDAY });
        expect(board.rerollsRemaining).toBe(2);
        expect(board.rerollChartersOwned).toBe(2);
        const entryId = weeklyQuestOf(board).boardEntryId;

        const first = await service.rerollEntry(userId, entryId, WEDNESDAY);
        expect(first).toMatchObject({
            consumableUsed: null,
            rerollsRemaining: 1,
            rerollChartersOwned: 2,
        });
        const second = await service.rerollEntry(userId, entryId, WEDNESDAY);
        expect(second).toMatchObject({
            consumableUsed: null,
            rerollsRemaining: 0,
            rerollChartersOwned: 2,
        });
        expect(second.quest.templateKey).not.toBe(first.quest.templateKey);

        const third = await service.rerollEntry(userId, entryId, WEDNESDAY);
        expect(third).toMatchObject({
            consumableUsed: GuildConsumableKey.REROLL_CHARTER,
            rerollsRemaining: 0,
            rerollChartersOwned: 1,
        });
        expect(third.quest.templateKey).not.toBe(second.quest.templateKey);
        expect(third.quest.rerollCount).toBe(3);
    });

    it("consumes a reroll_charter for Rank E members and 409s without one", async () => {
        const userId = await user();
        await source.query(
            "INSERT INTO guild_consumable_inventory (profileUserId, consumableKey, quantity) VALUES (?, ?, 1)",
            [userId, GuildConsumableKey.REROLL_CHARTER],
        );
        const board = await service.getBoard(userId, { now: WEDNESDAY });
        expect(board.rerollsRemaining).toBe(0);
        expect(board.rerollChartersOwned).toBe(1);
        const target = weeklyQuestOf(board);

        const rerolled = await service.rerollEntry(
            userId,
            target.boardEntryId,
            WEDNESDAY,
        );
        expect(rerolled).toMatchObject({
            consumableUsed: GuildConsumableKey.REROLL_CHARTER,
            rerollsRemaining: 0,
            rerollChartersOwned: 0,
        });
        expect(rerolled.quest.templateKey).not.toBe(target.templateKey);

        const noAllowance = await rejection(
            service.rerollEntry(userId, target.boardEntryId, WEDNESDAY),
        );
        expect(noAllowance.getStatus?.()).toBe(409);
        expect(noAllowance.getResponse?.()).toMatchObject({
            code: "guild_reroll_unavailable",
        });
    });

    it("409s rerolls of accepted or monthly quests and 404s foreign entries", async () => {
        const acceptedUser = await user();
        await guildProfile(acceptedUser, 800);
        const acceptedBoard = await service.getBoard(acceptedUser, {
            now: WEDNESDAY,
        });
        const acceptedEntryId = weeklyQuestOf(acceptedBoard).boardEntryId;
        await contract(acceptedUser, {
            boardEntryId: acceptedEntryId,
            status: GuildContractStatus.ACTIVE,
        });
        const accepted = await rejection(
            service.rerollEntry(acceptedUser, acceptedEntryId, WEDNESDAY),
        );
        expect(accepted.getStatus?.()).toBe(409);
        expect(accepted.getResponse?.()).toMatchObject({
            code: "guild_reroll_not_available",
        });

        const monthlyBoard = await service.getBoard(acceptedUser, {
            now: WEDNESDAY,
        });
        const monthlyEntryId = monthlyBoard.quests.find(
            (quest) => quest.cycle === GuildBoardCycle.MONTHLY,
        )?.boardEntryId;
        const monthly = await rejection(
            service.rerollEntry(acceptedUser, monthlyEntryId!, WEDNESDAY),
        );
        expect(monthly.getStatus?.()).toBe(409);
        expect(monthly.getResponse?.()).toMatchObject({
            code: "guild_reroll_not_available",
        });
        expect(
            (
                await service.getBoard(acceptedUser, { now: WEDNESDAY })
            ).quests.some((quest) => quest.boardEntryId === monthlyEntryId),
        ).toBe(true);

        const owner = await user();
        const foreignBoard = await service.getBoard(owner, { now: WEDNESDAY });
        const foreign = await rejection(
            service.rerollEntry(
                await user(),
                weeklyQuestOf(foreignBoard).boardEntryId,
                WEDNESDAY,
            ),
        );
        expect(foreign.getStatus?.()).toBe(404);
        expect(foreign.getResponse?.()).toMatchObject({
            code: "guild_board_entry_not_found",
        });
    });

    it("re-checks acceptance under the reroll lock without spending an allowance", async () => {
        const userId = await user();
        await guildProfile(userId, 0);
        await source.query(
            "INSERT INTO guild_consumable_inventory (profileUserId, consumableKey, quantity) VALUES (?, ?, 1)",
            [userId, GuildConsumableKey.REROLL_CHARTER],
        );
        const board = await service.getBoard(userId, { now: WEDNESDAY });
        const target = weeklyQuestOf(board);

        // Accept after the service's pre-lock read, before opening the reroll transaction.
        const realTransaction = source.transaction.bind(source);
        const transactionSpy = jest
            .spyOn(source, "transaction")
            .mockImplementationOnce((async (work: unknown) => {
                await contract(userId, {
                    boardEntryId: target.boardEntryId,
                    status: GuildContractStatus.ACTIVE,
                });
                return realTransaction(
                    work as (manager: EntityManager) => Promise<unknown>,
                );
            }) as typeof source.transaction);
        try {
            const rejected = await rejection(
                service.rerollEntry(userId, target.boardEntryId, WEDNESDAY),
            );
            expect(rejected.getStatus?.()).toBe(409);
            expect(rejected.getResponse?.()).toMatchObject({
                code: "guild_reroll_not_available",
            });
        } finally {
            transactionSpy.mockRestore();
        }

        await expect(
            source.query(
                "SELECT freeRerollWeekStart, freeRerollsUsedThisWeek FROM guild_profile WHERE profileUserId = ?",
                [userId],
            ),
        ).resolves.toEqual([
            { freeRerollWeekStart: null, freeRerollsUsedThisWeek: 0 },
        ]);
        await expect(
            source.query(
                "SELECT quantity FROM guild_consumable_inventory WHERE profileUserId = ? AND consumableKey = ?",
                [userId, GuildConsumableKey.REROLL_CHARTER],
            ),
        ).resolves.toEqual([{ quantity: 1 }]);
        await expect(
            source.query(
                "SELECT templateKey, rerollCount FROM guild_board_entry WHERE id = ?",
                [target.boardEntryId],
            ),
        ).resolves.toEqual([
            { templateKey: target.templateKey, rerollCount: 0 },
        ]);
    });

    it("rotates stale-backlog candidate chips across weeks from the wider pool", async () => {
        const gameIds: number[] = [];
        for (let index = 0; index < 20; index++) {
            gameIds.push(await game(`Pooled backlog ${index}`));
        }
        const chipsFor = (seed: Buffer) =>
            seededOrder(seed, gameIds, (gameId) => gameId).slice(0, 3);
        const userId = await user(
            fixedUserMatching(
                7,
                (seed, next) => chipsFor(seed).join() !== chipsFor(next).join(),
            ),
        );
        for (const gameId of gameIds) {
            await entry(userId, gameId, {
                plannedAt: new Date("2023-05-01T00:00:00Z"),
                createdAt: new Date("2023-05-01T00:00:00Z"),
            });
        }

        const chipsOf = (board: { quests: Array<any> }) =>
            libraryQuestOf(board)?.candidateGames.map(
                (game: { gameId: number }) => game.gameId,
            ) ?? [];

        const first = await service.getBoard(userId, { now: WEDNESDAY });
        const next = await service.getBoard(userId, { now: NEXT_WEDNESDAY });

        expect(chipsOf(first)).toEqual(chipsFor(weekSeed(userId)));
        expect(chipsOf(next)).toEqual(
            chipsFor(weekSeed(userId, NEXT_WEEK_START)),
        );
        expect(chipsOf(first)).not.toEqual(chipsOf(next));
    });

    it("links only active rewards to newly generated board entries", async () => {
        const userId = await user(
            fixedUserMatching(
                8,
                (seed) =>
                    expectedWinner(seed, ["recent_dust", "forgotten_relic"]) ===
                    "forgotten_relic",
            ),
        );
        await entry(userId, await game("Inactive reward relic"), {
            plannedAt: new Date("2023-05-01T00:00:00Z"),
            createdAt: new Date("2023-05-01T00:00:00Z"),
        });
        await source.query(
            "UPDATE guild_reward SET isActive = 0 WHERE `key` = ?",
            ["badge_archaeologist"],
        );

        try {
            const board = await service.getBoard(userId, { now: WEDNESDAY });
            const relic = board.quests.find(
                (quest) => quest.templateKey === "forgotten_relic",
            );
            expect(relic?.reward).toBeNull();
        } finally {
            await source.query(
                "UPDATE guild_reward SET isActive = 1 WHERE `key` = ?",
                ["badge_archaeologist"],
            );
        }
    });

    it("counts open quests without building the board or loading game chips", async () => {
        const userId = await user();
        await entry(
            userId,
            await game(
                "Counted relic",
                "//images.igdb.com/igdb/image/upload/t_thumb/co9.jpg",
            ),
            {
                plannedAt: new Date("2023-05-01T00:00:00Z"),
                createdAt: new Date("2023-05-01T00:00:00Z"),
            },
        );
        const eventId = await event({
            startsAt: new Date("2026-06-16T00:00:00Z"),
            endsAt: new Date("2026-06-23T00:00:00Z"),
        });
        // Generate the persisted board first so the count only reads its rows.
        await service.getBoard(userId, { now: WEDNESDAY });

        const query = jest.spyOn(source, "query");
        let count = 0;
        let statements: string[] = [];
        try {
            count = await service.getOpenBoardCount(userId, WEDNESDAY);
            statements = query.mock.calls.map(([sql]) => String(sql));
        } finally {
            query.mockRestore();
        }

        expect(statements.some((sql) => sql.includes("game_cover"))).toBe(
            false,
        );
        const board = await service.getBoard(userId, { now: WEDNESDAY });
        expect(board.quests.some((quest) => quest.eventId === eventId)).toBe(
            true,
        );
        expect(count).toBe(board.quests.length);
    });

    it("merges active published events with translations and reward, then drops them when archived", async () => {
        const userId = await user();
        const chestId = await rewardId("weekly_chest");
        const startsAt = new Date("2026-07-14T00:00:00Z");
        const endsAt = new Date("2026-07-21T00:00:00Z");
        const eventId = await event({
            startsAt,
            endsAt,
            rank: GuildRank.C,
            xpReward: 300,
            rewardId: chestId,
            title: "Metroidvania Month",
            description: "Finish a Metroidvania this month.",
            translations: [
                {
                    locale: GuildLocale.PT_BR,
                    title: "Mês do Metroidvania",
                    description: "Termine um Metroidvania neste mês.",
                },
                {
                    locale: GuildLocale.EN,
                    title: "Metroidvania Month",
                    description: "Finish a Metroidvania this month.",
                },
            ],
        });

        const now = new Date("2026-07-15T12:00:00Z");
        const board = await service.getBoard(userId, { now });
        const quest = board.quests.find((item) => item.eventId === eventId);

        expect(quest).toMatchObject({
            sourceType: "event",
            boardEntryId: null,
            eventId,
            category: GuildCategory.EVENT,
            cycle: null,
            templateKey: null,
            title: "Metroidvania Month",
            description: "Finish a Metroidvania this month.",
            rank: GuildRank.C,
            xpReward: 300,
            sealsReward: 0,
            candidateGames: [],
            meta: null,
            bonusObjective: null,
            rerollCount: 0,
            requiresTargetGame: false,
            isQuick: false,
            contractDurationDays: null,
            reward: { key: "weekly_chest" },
            expiresAt: endsAt,
        });
        expect(quest?.translations).toEqual([
            {
                locale: GuildLocale.EN,
                title: "Metroidvania Month",
                description: "Finish a Metroidvania this month.",
            },
            {
                locale: GuildLocale.PT_BR,
                title: "Mês do Metroidvania",
                description: "Termine um Metroidvania neste mês.",
            },
        ]);

        await source.query("UPDATE guild_event SET status = ? WHERE id = ?", [
            GuildEventStatus.ARCHIVED,
            eventId,
        ]);
        const archived = await service.getBoard(userId, { now });
        expect(archived.quests.some((item) => item.eventId === eventId)).toBe(
            false,
        );
    });

    it("flags at most one recommended quest, preferring library, then event, then weekly", async () => {
        const eventId = await event({
            startsAt: new Date("2026-08-11T00:00:00Z"),
            endsAt: new Date("2026-08-18T00:00:00Z"),
            rank: GuildRank.E,
        });
        const now = new Date("2026-08-12T12:00:00Z");

        const withBacklog = await user();
        await entry(withBacklog, await game("Old relic"), {
            plannedAt: new Date("2023-01-01T00:00:00Z"),
            createdAt: new Date("2023-01-01T00:00:00Z"),
        });
        const backlogBoard = await service.getBoard(withBacklog, { now });
        const backlogRecommended = backlogBoard.quests.filter(
            (quest) => quest.isRecommended,
        );
        expect(backlogRecommended).toHaveLength(1);
        expect(backlogRecommended[0].category).toBe(GuildCategory.LIBRARY);

        const emptyUser = await user();
        const eventBoard = await service.getBoard(emptyUser, { now });
        const eventRecommended = eventBoard.quests.filter(
            (quest) => quest.isRecommended,
        );
        expect(eventRecommended).toHaveLength(1);
        expect(eventRecommended[0].eventId).toBe(eventId);

        const laterBoard = await service.getBoard(await user(), {
            now: new Date("2026-10-14T12:00:00Z"),
        });
        const weeklyRecommended = laterBoard.quests.filter(
            (quest) => quest.isRecommended,
        );
        expect(weeklyRecommended).toHaveLength(1);
        expect(weeklyRecommended[0].category).toBe(GuildCategory.WEEKLY);
    });

    it("returns only quick quests ordered easiest first with ?quick=true", async () => {
        const userId = await user();
        const now = new Date("2026-09-16T12:00:00Z");
        const startsAt = new Date("2026-09-15T00:00:00Z");
        const endsAt = new Date("2026-09-22T00:00:00Z");
        const [eventE, eventD, eventB, eventA] = await Promise.all([
            event({ startsAt, endsAt, rank: GuildRank.E }),
            event({ startsAt, endsAt, rank: GuildRank.D }),
            event({ startsAt, endsAt, rank: GuildRank.B }),
            event({ startsAt, endsAt, rank: GuildRank.A }),
        ]);

        const board = await service.getBoard(userId, { now, quick: true });

        expect(board.quests.length).toBeGreaterThan(0);
        expect(board.quests.every((quest) => quest.isQuick)).toBe(true);
        expect(
            board.quests.some(
                (quest) =>
                    quest.rank === GuildRank.A || quest.rank === GuildRank.B,
            ),
        ).toBe(false);
        expect(board.quests.some((quest) => quest.eventId === eventE)).toBe(
            true,
        );
        expect(board.quests.some((quest) => quest.eventId === eventD)).toBe(
            true,
        );
        expect(board.quests.some((quest) => quest.eventId === eventB)).toBe(
            false,
        );
        expect(board.quests.some((quest) => quest.eventId === eventA)).toBe(
            false,
        );

        const rankOrder: Record<GuildRank, number> = {
            [GuildRank.E]: 0,
            [GuildRank.D]: 1,
            [GuildRank.C]: 2,
            [GuildRank.B]: 3,
            [GuildRank.A]: 4,
            [GuildRank.S]: 5,
        };
        const ranks = board.quests.map((quest) => quest.rank);
        expect(ranks[0]).toBe(GuildRank.E);
        expect(ranks).toEqual(
            [...ranks].sort((a, b) => rankOrder[a] - rankOrder[b]),
        );
    });

    it("hides accepted/completed quests and shows abandoned ones again", async () => {
        const userId = await user();
        const eventId = await event({
            startsAt: new Date("2026-06-16T00:00:00Z"),
            endsAt: new Date("2026-06-23T00:00:00Z"),
        });
        await entry(userId, await game("Relic"), {
            plannedAt: new Date("2023-05-01T00:00:00Z"),
            createdAt: new Date("2023-05-01T00:00:00Z"),
        });

        const full = await service.getBoard(userId, { now: WEDNESDAY });
        const quest = full.quests.find(
            (item) => item.sourceType === "board_entry",
        );
        expect(quest?.boardEntryId).toEqual(expect.any(String));
        expect(await service.getOpenBoardCount(userId, WEDNESDAY)).toBe(
            full.quests.length,
        );

        const contractId = await contract(userId, {
            boardEntryId: quest!.boardEntryId,
            status: GuildContractStatus.ACTIVE,
        });
        const hidden = await service.getBoard(userId, { now: WEDNESDAY });
        expect(
            hidden.quests.some(
                (item) => item.boardEntryId === quest!.boardEntryId,
            ),
        ).toBe(false);
        expect(hidden.quests).toHaveLength(full.quests.length - 1);
        expect(await service.getOpenBoardCount(userId, WEDNESDAY)).toBe(
            full.quests.length - 1,
        );

        for (const status of [
            GuildContractStatus.READY_TO_CLAIM,
            GuildContractStatus.COMPLETED,
        ]) {
            await source.query(
                "UPDATE guild_contract SET status = ? WHERE id = ?",
                [status, contractId],
            );
            const stillHidden = await service.getBoard(userId, {
                now: WEDNESDAY,
            });
            expect(
                stillHidden.quests.some(
                    (item) => item.boardEntryId === quest!.boardEntryId,
                ),
            ).toBe(false);
        }

        await source.query(
            "UPDATE guild_contract SET status = ? WHERE id = ?",
            [GuildContractStatus.ABANDONED, contractId],
        );
        const restored = await service.getBoard(userId, { now: WEDNESDAY });
        expect(
            restored.quests.some(
                (item) => item.boardEntryId === quest!.boardEntryId,
            ),
        ).toBe(true);
        expect(restored.quests).toHaveLength(full.quests.length);

        expect(restored.quests.some((item) => item.eventId === eventId)).toBe(
            true,
        );
        const eventContractId = await contract(userId, {
            eventId,
            status: GuildContractStatus.ACTIVE,
        });
        const eventHidden = await service.getBoard(userId, {
            now: WEDNESDAY,
        });
        expect(
            eventHidden.quests.some((item) => item.eventId === eventId),
        ).toBe(false);

        await source.query(
            "UPDATE guild_contract SET status = ? WHERE id = ?",
            [GuildContractStatus.ABANDONED, eventContractId],
        );
        const eventRestored = await service.getBoard(userId, {
            now: WEDNESDAY,
        });
        expect(
            eventRestored.quests.some((item) => item.eventId === eventId),
        ).toBe(true);
    });

    it("rolls back every slot when a later slot insert fails", async () => {
        const userId = await user();
        await entry(userId, await game("Trigger relic"), {
            plannedAt: new Date("2023-05-01T00:00:00Z"),
            createdAt: new Date("2023-05-01T00:00:00Z"),
        });
        await source.query(
            `CREATE TRIGGER guild_board_entry_reject_slot_two
             BEFORE INSERT ON guild_board_entry
             FOR EACH ROW
             BEGIN
                 IF NEW.slotIndex = 2 THEN
                     SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'slot 2 rejected';
                 END IF;
             END`,
        );

        try {
            await expect(
                service.ensureWeeklyEntries(userId, WEDNESDAY),
            ).rejects.toThrow();
        } finally {
            await source.query(
                "DROP TRIGGER IF EXISTS guild_board_entry_reject_slot_two",
            );
        }

        expect(
            await source.query(
                "SELECT COUNT(*) AS total FROM guild_board_entry WHERE profileUserId = ?",
                [userId],
            ),
        ).toEqual([{ total: 0 }]);
    });

    it("tops up a partial board without replacing its existing slot", async () => {
        const userId = await user();
        const existingId = randomUUID();
        await source.query(
            `INSERT INTO guild_board_entry
                (id, profileUserId, weekStart, cycle, periodKey, slotIndex, category, templateKey, \`rank\`, xpReward,
                 objectiveType, targetCount, criteria, candidateGames, requiresTargetGame, rewardId,
                 isRecommended, isQuick, expiresAt)
             VALUES (?, ?, '2026-06-15', 'weekly', '2026-06-15', 0, ?, 'forgotten_relic', ?, 120, ?, 1, '{}', '[]', 1, NULL, 0, 0, ?)`,
            [
                existingId,
                userId,
                GuildCategory.LIBRARY,
                GuildRank.C,
                GuildObjectiveType.FINISH_GAME,
                new Date("2026-06-22T03:00:00Z"),
            ],
        );

        const entries = await service.ensureWeeklyEntries(userId, WEDNESDAY);

        expect(entries.map((entry) => entry.slotIndex)).toEqual([0, 1, 2]);
        expect(entries[0]).toMatchObject({
            id: existingId,
            templateKey: "forgotten_relic",
        });
        expect(entries.filter((entry) => entry.id !== existingId)).toHaveLength(
            2,
        );
        expect(
            await source.query(
                "SELECT COUNT(*) AS total FROM guild_board_entry WHERE profileUserId = ?",
                [userId],
            ),
        ).toEqual([{ total: 3 }]);
    });

    it("prefetches backlog TTB for active members in bounded chunks and survives outages", async () => {
        const active = await user(fixedUserId(20, 0));
        await source.query(
            "INSERT INTO guild_profile (profileUserId, lastVisitedAt) VALUES (?, ?)",
            [active, WEDNESDAY],
        );
        const activeGameIds: number[] = [];
        for (let index = 0; index < 85; index++) {
            const gameId = await game(`Prefetch backlog ${index}`);
            activeGameIds.push(gameId);
            await entry(active, gameId, {
                createdAt: new Date("2026-05-01T00:00:00Z"),
            });
        }
        // Fresh cache row: must be skipped by the sweep.
        await timeToBeat(
            activeGameIds[0],
            10,
            new Date(WEDNESDAY.getTime() - DAY_MS),
        );

        const inactive = await user(fixedUserId(20, 1));
        await source.query(
            "INSERT INTO guild_profile (profileUserId, lastVisitedAt) VALUES (?, ?)",
            [inactive, new Date(WEDNESDAY.getTime() - 60 * DAY_MS)],
        );
        await entry(inactive, await game("Inactive backlog"), {
            createdAt: new Date("2026-05-01T00:00:00Z"),
        });

        const neverVisited = await user(fixedUserId(20, 2));
        await entry(neverVisited, await game("Unvisited backlog"), {
            createdAt: new Date("2026-05-01T00:00:00Z"),
        });

        getTimesToBeat.mockRejectedValue(new Error("IGDB quota exceeded"));
        const attempted =
            await scheduler.prefetchTimeToBeatForActiveMembers(WEDNESDAY);

        expect(attempted).toBe(80);
        expect(getTimesToBeat).toHaveBeenCalledTimes(2);
        const fetchedIds = getTimesToBeat.mock.calls.map(
            ([ids]) => ids as number[],
        );
        expect(fetchedIds[0]).toHaveLength(40);
        expect(fetchedIds[1]).toHaveLength(40);
        expect(fetchedIds.flat()).toEqual(activeGameIds.slice(1, 81));

        // A later successful tick negative-caches the same bounded batch.
        getTimesToBeat.mockReset();
        getTimesToBeat.mockResolvedValue([]);
        const warmedAgain =
            await scheduler.prefetchTimeToBeatForActiveMembers(WEDNESDAY);
        expect(warmedAgain).toBe(80);
        expect(getTimesToBeat).toHaveBeenCalledTimes(2);
        expect(getTimesToBeat.mock.calls[0][0]).toEqual(
            activeGameIds.slice(1, 41),
        );
        expect(getTimesToBeat.mock.calls[1][0]).toEqual(
            activeGameIds.slice(41, 81),
        );
        const [{ total: negativeCached }] = await source.query(
            "SELECT COUNT(*) AS total FROM game_time_to_beat",
        );
        expect(Number(negativeCached)).toBe(81);

        // Everything else is now cached, so only the tail is warmed.
        getTimesToBeat.mockReset();
        getTimesToBeat.mockResolvedValue([]);
        const warmedTail =
            await scheduler.prefetchTimeToBeatForActiveMembers(WEDNESDAY);
        expect(warmedTail).toBe(4);
        expect(getTimesToBeat).toHaveBeenCalledTimes(1);
        expect(getTimesToBeat.mock.calls[0][0]).toEqual(
            activeGameIds.slice(81),
        );
        const [{ total }] = await source.query(
            "SELECT COUNT(*) AS total FROM game_time_to_beat",
        );
        expect(Number(total)).toBe(85);
    });

    it("makes the TTB prefetch tick swallow unexpected sweep errors", async () => {
        const failingScheduler = new GuildScheduler(
            {
                query: async () => Promise.reject(new Error("db down")),
            } as unknown as DataSource,
            {
                expireOverdueContracts: async () => undefined,
            } as unknown as GuildContractEvaluatorService,
            {
                notifyExpiring: async () => undefined,
            } as unknown as GuildContractRemindersService,
            new GuildTimeToBeatService(source.getRepository(GameTimeToBeat), {
                getTimesToBeat,
            } as unknown as IgdbPlaytimeSyncService),
        );

        await expect(
            failingScheduler.timeToBeatPrefetchTick(),
        ).resolves.toBeUndefined();
        expect(getTimesToBeat).not.toHaveBeenCalled();
    });
});
