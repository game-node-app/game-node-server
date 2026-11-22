import "reflect-metadata";
import { createHash, randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { createAwardsTestDatabase } from "../../test/awards/awards-test-database";
import { CollectionEntryStatus } from "../collections/collections-entries/collections-entries.constants";
import { IGDBTimeToBeatPlaytime } from "../sync/igdb/igdb.types";
import { IgdbPlaytimeSyncService } from "../sync/igdb/playtime/igdb-playtime-sync.service";
import { GameTimeToBeat } from "./entities/game-time-to-beat.entity";
import { GuildBoardService } from "./guild-board.service";
import { GuildTimeToBeatService } from "./guild-time-to-beat.service";
import { GuildBoardResponseDto } from "./dto/guild-board.dto";
import {
    GuildCategory,
    GuildContractStatus,
    GuildEventStatus,
    GuildLocale,
    GuildObjectiveType,
    GuildRank,
    GuildRewardKind,
    seededOrder,
} from "./guild.constants";

const RANK_ORDER: Record<GuildRank, number> = {
    [GuildRank.E]: 0,
    [GuildRank.D]: 1,
    [GuildRank.C]: 2,
    [GuildRank.B]: 3,
    [GuildRank.A]: 4,
    [GuildRank.S]: 5,
};

const WEDNESDAY = new Date("2026-06-17T12:00:00Z");
const NEXT_WEDNESDAY = new Date("2026-06-24T12:00:00Z");

const WEEK_START = "2026-06-15";
const NEXT_WEEK_START = "2026-06-22";

const weekSeed = (userId: string, weekStart = WEEK_START) =>
    createHash("sha256").update(`${userId}:${weekStart}`).digest();

const fixedUserId = (namespace: number, index: number) =>
    `${namespace.toString(16).padStart(4, "0")}${index
        .toString(16)
        .padStart(4, "0")}-0000-4000-8000-000000000000`;

/** First fixed user whose weekly seed bytes match, so rotation tests stay deterministic. */
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

describe("GuildBoardService (integration)", () => {
    jest.setTimeout(120000);

    // Unique database so parallel suites never share or wipe the same schema.
    const database = `guild_test_board_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    let db: Awaited<ReturnType<typeof createAwardsTestDatabase>> | undefined;
    let source: DataSource;
    let service: GuildBoardService;
    const getTimesToBeat = jest.fn();
    let nextGameId = 7_000_000;
    let nextPlatformId = 8_000_000;

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
        service = new GuildBoardService(
            source,
            new GuildTimeToBeatService(source.getRepository(GameTimeToBeat), {
                getTimesToBeat,
            } as unknown as IgdbPlaytimeSyncService),
        );

        const starterRewards = [
            ["badge_archaeologist", GuildRewardKind.BADGE, 0],
            ["weekly_chest", GuildRewardKind.WEEKLY_CHEST, 75],
            ["title_chronist", GuildRewardKind.TITLE, 0],
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
        expect(second.weekStart).toBe(first.weekStart);
        expect(second.nextRefreshAt).toEqual(first.nextRefreshAt);
        expect(second.quests).toEqual(first.quests);
        expect(
            first.quests.filter((quest) => quest.sourceType === "board_entry"),
        ).toHaveLength(3);
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
        expect(
            entries.some((quest) => quest.category === GuildCategory.LIBRARY),
        ).toBe(false);
        expect(
            entries.some(
                (quest) =>
                    quest.templateKey === "forgotten_relic" ||
                    quest.templateKey === "deep_dive",
            ),
        ).toBe(false);
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

    it("builds a forgotten_relic quest with enriched stale-backlog chips", async () => {
        const userId = await user();
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
            requiresTargetGame: true,
            contractDurationDays: 21,
            meta: { sinceYear: 2023 },
            reward: { key: "badge_archaeologist" },
        });
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

    it("uses cached short games for short_caravan and degrades to weekend_sprint when IGDB fails", async () => {
        const userId = await user(
            fixedUserMatching(1, (seed) => seed[2] % 3 === 0),
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
        expect(shortQuest?.templateKey).toBe("short_caravan");
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

        const degradedUser = await user(
            fixedUserMatching(2, (seed) => seed[2] % 3 === 0),
        );
        await entry(degradedUser, await game("Uncached game"), {
            createdAt: new Date("2026-06-01T00:00:00Z"),
        });
        getTimesToBeat.mockRejectedValueOnce(new Error("IGDB timeout"));

        const degradedBoard = await service.getBoard(degradedUser, {
            now: WEDNESDAY,
        });
        const degradedQuest = degradedBoard.quests.find(
            (quest) => quest.templateKey === "weekend_sprint",
        );
        expect(degradedQuest?.templateKey).toBe("weekend_sprint");
        expect(degradedQuest?.candidateGames).toEqual([]);
        expect(degradedBoard.quests.length).toBeGreaterThan(0);
    });

    it("keeps previously finished games out of stale, playing and short candidate chips", async () => {
        const userId = await user(
            fixedUserMatching(7, (seed) => seed[2] % 3 === 0),
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

        expect(
            boardEntries.some((quest) =>
                ["forgotten_relic", "deep_dive"].includes(
                    quest.templateKey ?? "",
                ),
            ),
        ).toBe(false);
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
        // No library candidates: the slot falls back to an unused weekly/gamenode template.
        expect(boardEntries).toHaveLength(3);
        expect(await service.getOpenBoardCount(userId, WEDNESDAY)).toBe(
            board.quests.length,
        );
    });

    it("rotates weekly and gamenode slots across weeks while the same week stays stable", async () => {
        const gamenodeUser = await user(
            fixedUserMatching(3, (seed, next) => seed[0] % 3 !== next[0] % 3),
        );
        const weeklyUser = await user(
            fixedUserMatching(4, (seed, next) => seed[2] % 2 !== next[2] % 2),
        );
        for (const userId of [gamenodeUser, weeklyUser]) {
            await entry(userId, await game("Week rotation relic"), {
                plannedAt: new Date("2023-05-01T00:00:00Z"),
                createdAt: new Date("2023-05-01T00:00:00Z"),
            });
        }

        const templateOf = async (
            userId: string,
            now: Date,
            category: GuildCategory,
        ) => {
            const board = await service.getBoard(userId, { now });
            return board.quests.find((quest) => quest.category === category)
                ?.templateKey;
        };
        const gamenodeOf = (userId: string, now: Date) =>
            templateOf(userId, now, GuildCategory.GAMENODE);
        const weeklyOf = (userId: string, now: Date) =>
            templateOf(userId, now, GuildCategory.WEEKLY);

        const gamenodeFirst = await gamenodeOf(gamenodeUser, WEDNESDAY);
        const weeklyFirst = await weeklyOf(weeklyUser, WEDNESDAY);
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

    it("rotates the new double_feature and quick_take templates onto the board", async () => {
        const userId = await user(
            fixedUserMatching(
                5,
                (seed) => seed[2] % 2 === 1 && seed[0] % 3 === 2,
            ),
        );
        await entry(userId, await game("New template relic"), {
            plannedAt: new Date("2023-05-01T00:00:00Z"),
            createdAt: new Date("2023-05-01T00:00:00Z"),
        });

        const board = await service.getBoard(userId, { now: WEDNESDAY });
        const questsByTemplate = new Map(
            board.quests.map((quest) => [quest.templateKey, quest]),
        );

        expect([...questsByTemplate.keys()]).toEqual(
            expect.arrayContaining([
                "forgotten_relic",
                "double_feature",
                "quick_take",
            ]),
        );
        expect(
            questsByTemplate.get("forgotten_relic")?.contractDurationDays,
        ).toBe(21);
        expect(
            questsByTemplate.get("double_feature")?.contractDurationDays,
        ).toBe(7);
        expect(questsByTemplate.get("double_feature")?.targetCount).toBe(2);
        expect(questsByTemplate.get("quick_take")?.contractDurationDays).toBe(
            7,
        );
        expect(questsByTemplate.get("quick_take")?.isQuick).toBe(true);
    });

    it("links only active rewards to newly generated board entries", async () => {
        const userId = await user();
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

    it("rotates stale-backlog candidate chips across weeks from the wider pool", async () => {
        const gameIds: number[] = [];
        for (let index = 0; index < 20; index++) {
            gameIds.push(await game(`Pooled backlog ${index}`));
        }
        const chipsFor = (seed: Buffer) =>
            seededOrder(seed, gameIds, (gameId) => gameId).slice(0, 3);
        const userId = await user(
            fixedUserMatching(
                6,
                (seed, next) => chipsFor(seed).join() !== chipsFor(next).join(),
            ),
        );
        for (const gameId of gameIds) {
            await entry(userId, gameId, {
                plannedAt: new Date("2023-05-01T00:00:00Z"),
                createdAt: new Date("2023-05-01T00:00:00Z"),
            });
        }

        const chipsOf = (board: GuildBoardResponseDto) =>
            board.quests
                .find((quest) => quest.templateKey === "forgotten_relic")
                ?.candidateGames.map((game) => game.gameId) ?? [];

        const first = await service.getBoard(userId, { now: WEDNESDAY });
        const next = await service.getBoard(userId, { now: NEXT_WEDNESDAY });

        expect(chipsOf(first)).toEqual(chipsFor(weekSeed(userId)));
        expect(chipsOf(next)).toEqual(
            chipsFor(weekSeed(userId, NEXT_WEEK_START)),
        );
        expect(chipsOf(first)).not.toEqual(chipsOf(next));
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
            templateKey: null,
            title: "Metroidvania Month",
            description: "Finish a Metroidvania this month.",
            rank: GuildRank.C,
            xpReward: 300,
            candidateGames: [],
            meta: null,
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

    it("flags at most one recommended quest, preferring stale backlog, then event, then weekly", async () => {
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
        expect(backlogRecommended[0].templateKey).toBe("forgotten_relic");

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

        const ranks = board.quests.map((quest) => quest.rank);
        expect(ranks[0]).toBe(GuildRank.E);
        expect(ranks).toEqual(
            [...ranks].sort((a, b) => RANK_ORDER[a] - RANK_ORDER[b]),
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
        const relic = full.quests.find(
            (quest) => quest.templateKey === "forgotten_relic",
        );
        expect(relic?.boardEntryId).toEqual(expect.any(String));
        expect(await service.getOpenBoardCount(userId, WEDNESDAY)).toBe(
            full.quests.length,
        );

        const contractId = await contract(userId, {
            boardEntryId: relic!.boardEntryId,
            status: GuildContractStatus.ACTIVE,
        });
        const hidden = await service.getBoard(userId, { now: WEDNESDAY });
        expect(
            hidden.quests.some(
                (quest) => quest.boardEntryId === relic!.boardEntryId,
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
                    (quest) => quest.boardEntryId === relic!.boardEntryId,
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
                (quest) => quest.boardEntryId === relic!.boardEntryId,
            ),
        ).toBe(true);
        expect(restored.quests).toHaveLength(full.quests.length);

        const withEvent = restored;
        expect(
            withEvent.quests.some((quest) => quest.eventId === eventId),
        ).toBe(true);
        const eventContractId = await contract(userId, {
            eventId,
            status: GuildContractStatus.ACTIVE,
        });
        const eventHidden = await service.getBoard(userId, {
            now: WEDNESDAY,
        });
        expect(
            eventHidden.quests.some((quest) => quest.eventId === eventId),
        ).toBe(false);

        await source.query(
            "UPDATE guild_contract SET status = ? WHERE id = ?",
            [GuildContractStatus.ABANDONED, eventContractId],
        );
        const eventRestored = await service.getBoard(userId, {
            now: WEDNESDAY,
        });
        expect(
            eventRestored.quests.some((quest) => quest.eventId === eventId),
        ).toBe(true);
    });

    it("rolls back every slot when a later slot insert fails", async () => {
        const userId = await user();
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
                (id, profileUserId, weekStart, slotIndex, category, templateKey, \`rank\`, xpReward,
                 objectiveType, targetCount, criteria, candidateGames, requiresTargetGame, rewardId,
                 isRecommended, isQuick, expiresAt)
             VALUES (?, ?, '2026-06-15', 0, ?, 'forgotten_relic', ?, 120, ?, 1, '{}', '[]', 1, NULL, 0, 0, ?)`,
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
});
