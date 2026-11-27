import "reflect-metadata";
import { createHash, randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { createAwardsTestDatabase } from "../../test/awards/awards-test-database";
import { CollectionEntryStatus } from "../collections/collections-entries/collections-entries.constants";
import { IGDBTimeToBeatPlaytime } from "../sync/igdb/igdb.types";
import { IgdbPlaytimeSyncService } from "../sync/igdb/playtime/igdb-playtime-sync.service";
import { GameTimeToBeat } from "./entities/game-time-to-beat.entity";
import { GuildProceduralBoardService } from "./guild-procedural-board.service";
import { GuildTimeToBeatService } from "./guild-time-to-beat.service";
import {
    GUILD_SYSTEM_TEMPLATES,
    GuildQuestTemplate,
} from "./guild-templates.constants";
import {
    DAY_MS,
    GuildBoardCycle,
    GuildRank,
    guildRankAtLeast,
    seededOrder,
} from "./guild.constants";

const NOW = new Date("2026-11-15T12:00:00Z");
const MONTH_KEY = "2026-11";
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

const PROCEDURAL_TEMPLATE_KEYS = [
    "recent_dust",
    "forgotten_relic",
    "ancient_fossil",
    "off_the_map",
    "continue_the_saga",
    "time_machine",
    "hidden_gem",
    "return_to_the_world",
    "the_colossus",
    "colossus_legend",
    "genre_marathon",
    "saga_trilogy",
] as const;

const template = (key: string): GuildQuestTemplate =>
    GUILD_SYSTEM_TEMPLATES.find((item) => item.key === key)!;

const monthlyPool = (rank: GuildRank) =>
    GUILD_SYSTEM_TEMPLATES.filter(
        (item) =>
            item.cycle === GuildBoardCycle.MONTHLY &&
            guildRankAtLeast(rank, item.minRank),
    );

const monthlySeed = (userId: string, monthKey = MONTH_KEY) =>
    createHash("sha256").update(`${userId}:monthly:${monthKey}`).digest();

const expectedMonthlyWinner = (userId: string, rank: GuildRank) =>
    seededOrder(monthlySeed(userId), monthlyPool(rank), (item) => item.key)[0];

const fixedUserId = (index: number) =>
    `f${index.toString(16).padStart(7, "0")}-0000-4000-8000-000000000001`;

describe("GuildProceduralBoardService (integration)", () => {
    jest.setTimeout(120000);

    // Unique database so parallel suites never share or wipe the same schema.
    const database = `guild_test_procedural_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    let db: Awaited<ReturnType<typeof createAwardsTestDatabase>> | undefined;
    let source: DataSource;
    let service: GuildProceduralBoardService;
    const getTimesToBeat = jest.fn();
    let nextGameId = 9_000_000;
    let nextResourceId = 1_000_000;
    let nextExternalGameId = 5_000_000;
    let nextPlatformId = 8_000_000;

    beforeAll(async () => {
        db = await createAwardsTestDatabase(database);
        source = db.source;
        service = new GuildProceduralBoardService(
            source,
            new GuildTimeToBeatService(source.getRepository(GameTimeToBeat), {
                getTimesToBeat,
            } as unknown as IgdbPlaytimeSyncService),
        );
    });

    afterAll(async () => {
        await db?.destroy();
    });

    beforeEach(() => {
        getTimesToBeat.mockReset();
        getTimesToBeat.mockResolvedValue([] as IGDBTimeToBeatPlaytime[]);
    });

    async function user(
        createdAt = daysAgo(400),
        userId: string = randomUUID(),
    ): Promise<string> {
        await source.query(
            "INSERT INTO profile (userId, username, createdAt) VALUES (?, ?, ?)",
            [userId, `u-${userId.slice(0, 8)}`, createdAt],
        );
        await source.query("INSERT INTO library (userId) VALUES (?)", [userId]);
        return userId;
    }

    async function game(
        values: {
            releasedAt?: Date | null;
            ratingCount?: number | null;
        } = {},
    ) {
        const id = nextGameId++;
        await source.query(
            `INSERT INTO game (id, name, slug, firstReleaseDate, aggregatedRatingCount)
             VALUES (?, ?, ?, ?, ?)`,
            [
                id,
                `Game ${id}`,
                `game-${id}`,
                values.releasedAt ?? null,
                values.ratingCount ?? null,
            ],
        );
        return id;
    }

    async function entry(
        userId: string,
        gameId: number,
        values: {
            status?: CollectionEntryStatus;
            createdAt?: Date;
            plannedAt?: Date | null;
            startedAt?: Date | null;
            finishedAt?: Date | null;
        } = {},
    ) {
        const createdAt = values.createdAt ?? daysAgo(10);
        await source.query(
            `INSERT INTO collection_entry
                (id, gameId, libraryUserId, status, createdAt, updatedAt, plannedAt, startedAt, finishedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                randomUUID(),
                gameId,
                userId,
                values.status ?? CollectionEntryStatus.PLANNED,
                createdAt,
                createdAt,
                values.plannedAt ?? createdAt,
                values.startedAt ?? null,
                values.finishedAt ?? null,
            ],
        );
    }

    async function finishHistory(
        userId: string,
        gameId: number,
        at = daysAgo(30),
    ) {
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

    async function timeToBeat(gameId: number, hours: number) {
        await source.query(
            `INSERT INTO game_time_to_beat
                (gameId, normallySeconds, hastilySeconds, completelySeconds, submitCount, fetchedAt)
             VALUES (?, ?, NULL, NULL, 1, NOW())`,
            [gameId, Math.round(hours * 3_600)],
        );
    }

    async function resource(
        table: "game_genre" | "game_franchise" | "game_theme",
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

    async function linkTheme(gameId: number, themeId: number) {
        await source.query(
            "INSERT INTO game_themes_game_theme (gameId, gameThemeId) VALUES (?, ?)",
            [gameId, themeId],
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
            ["achievement-1", userId, externalGameId, daysAgo(1)],
        );
    }

    async function completionStatus(userId: string, gameId: number) {
        const externalGameId = nextExternalGameId++;
        await source.query(
            "INSERT INTO game_external_game (id, uid, gameId) VALUES (?, ?, ?)",
            [externalGameId, `ext-${externalGameId}`, gameId],
        );
        await source.query(
            `INSERT INTO game_completion_status
                (externalGameId, profileUserId, isCompleted, isPlatinumObtained,
                 totalAvailableAchievements, totalObtainedAchievements, completedAt, checksum)
             VALUES (?, ?, 1, 0, 10, 10, ?, 'checksum')`,
            [externalGameId, userId, daysAgo(2)],
        );
    }

    /** Library where every Monthly Expedition template is eligible. */
    async function allMonthlyTemplatesUser(userId: string = randomUUID()) {
        const libraryUserId = await user(daysAgo(800), userId);
        const genreId = await resource("game_genre", "RPG");
        const franchiseId = await resource("game_franchise", "Saga");
        const ancient = await game();
        const legendary = await game();
        const third = await game();
        await timeToBeat(legendary, 70);
        for (const gameId of [ancient, legendary, third]) {
            await linkGenre(gameId, genreId);
            await linkFranchise(gameId, franchiseId);
        }
        await entry(libraryUserId, ancient, {
            plannedAt: daysAgo(1_200),
            createdAt: daysAgo(1_200),
        });
        await entry(libraryUserId, legendary, {
            plannedAt: daysAgo(30),
            createdAt: daysAgo(30),
        });
        await entry(libraryUserId, third, {
            plannedAt: daysAgo(20),
            createdAt: daysAgo(20),
        });
        await syncedAchievement(libraryUserId, third);
        return { userId: libraryUserId, ancient, legendary };
    }

    it("synthesizes the three backlog staleness tiers and ignores recent playtime", async () => {
        const userId = await user();
        const fresh = await game();
        const recent = await game();
        const relic = await game();
        const ancient = await game();
        const playedRelic = await game();
        await entry(userId, fresh, {
            plannedAt: daysAgo(10),
            createdAt: daysAgo(10),
        });
        for (const [gameId, days] of [
            [recent, 120],
            [relic, 500],
            [ancient, 1_200],
            [playedRelic, 600],
        ] as const)
            await entry(userId, gameId, {
                plannedAt: daysAgo(days),
                createdAt: daysAgo(days),
            });
        await playtime(userId, playedRelic, daysAgo(20));

        const recentDust = await service.evaluateTemplate(
            userId,
            "recent_dust",
            { now: NOW },
        );
        expect(recentDust).toMatchObject({ eligible: true });
        expect(recentDust?.meta?.staleDays).toBeGreaterThanOrEqual(90);
        expect(recentDust?.candidateGames.map((game) => game.gameId)).toEqual(
            expect.arrayContaining([recent, relic, ancient]),
        );
        expect(recentDust?.candidateGames).toHaveLength(3);
        expect(
            recentDust?.candidateGames.map((game) => game.gameId),
        ).not.toEqual(expect.arrayContaining([fresh, playedRelic]));

        const forgottenRelic = await service.evaluateTemplate(
            userId,
            "forgotten_relic",
            { now: NOW },
        );
        expect(forgottenRelic?.meta?.staleDays).toBeGreaterThanOrEqual(365);
        expect(
            forgottenRelic?.candidateGames.map((game) => game.gameId).sort(),
        ).toEqual([relic, ancient].sort());

        const ancientFossil = await service.evaluateTemplate(
            userId,
            "ancient_fossil",
            { now: NOW },
        );
        expect(ancientFossil?.meta?.staleDays).toBeGreaterThanOrEqual(1_095);
        expect(
            ancientFossil?.candidateGames.map((game) => game.gameId),
        ).toEqual([ancient]);
    });

    it("unlocks ancient_fossil for the oldest backlog of a 2+ year old library", async () => {
        const veteran = await user(daysAgo(900));
        const oldGame = await game();
        await entry(veteran, oldGame, {
            plannedAt: daysAgo(800),
            createdAt: daysAgo(800),
        });
        const veteranQuest = await service.evaluateTemplate(
            veteran,
            "ancient_fossil",
            { now: NOW },
        );
        expect(veteranQuest?.meta?.staleDays).toBeGreaterThanOrEqual(730);
        expect(veteranQuest?.candidateGames).toEqual([
            expect.objectContaining({ gameId: oldGame }),
        ]);

        const young = await user(daysAgo(365));
        const youngGame = await game();
        await entry(young, youngGame, {
            plannedAt: daysAgo(800),
            createdAt: daysAgo(800),
        });
        expect(
            await service.evaluateTemplate(young, "ancient_fossil", {
                now: NOW,
            }),
        ).toBeNull();
    });

    it("skips every procedural generator cleanly for an empty library", async () => {
        const userId = await user();
        const templates = PROCEDURAL_TEMPLATE_KEYS.map((key) => template(key));
        expect(
            await service.resolveTemplates(userId, templates, { now: NOW }),
        ).toEqual([]);
        expect(
            await service.evaluateTemplate(userId, "the_colossus", {
                now: NOW,
            }),
        ).toBeNull();
        expect(
            await service.evaluateTemplate(userId, "unknown_template", {
                now: NOW,
            }),
        ).toBeNull();

        const fallback = await service.evaluateTemplate(
            userId,
            "deep_critic_anthology",
            { now: NOW },
        );
        expect(fallback).toMatchObject({
            eligible: true,
            criteria: { minReviewChars: 250 },
            candidateGames: [],
            meta: null,
        });
        expect(
            await service.evaluateTemplate(userId, "quick_take", { now: NOW }),
        ).toMatchObject({ eligible: true });
        expect(
            await service.resolveTemplates(
                userId,
                [template("the_colossus"), template("deep_critic_anthology")],
                { now: NOW },
            ),
        ).toEqual([
            expect.objectContaining({
                template: expect.objectContaining({
                    key: "deep_critic_anthology",
                }),
            }),
        ]);
    });

    it("off_the_map inverts genres underrepresented among finished games", async () => {
        const userId = await user();
        const rpg = await resource("game_genre", "RPG");
        const shooter = await resource("game_genre", "Shooter");
        for (let index = 0; index < 3; index++) {
            const finished = await game();
            await linkGenre(finished, rpg);
            await finishHistory(userId, finished);
        }
        const plannedShooter = await game();
        const plannedRpg = await game();
        await linkGenre(plannedShooter, shooter);
        await linkGenre(plannedRpg, rpg);
        await entry(userId, plannedShooter);
        await entry(userId, plannedRpg);

        const quest = await service.evaluateTemplate(userId, "off_the_map", {
            now: NOW,
        });
        expect(quest).toMatchObject({
            eligible: true,
            criteria: { genreIds: [shooter] },
            meta: { genreName: "Shooter" },
            candidateGames: [{ gameId: plannedShooter }],
        });

        const noInversion = await user();
        const plannedOnlyRpg = await game();
        await linkGenre(plannedOnlyRpg, rpg);
        await entry(noInversion, plannedOnlyRpg);
        const rpgFinished = await game();
        await linkGenre(rpgFinished, rpg);
        await finishHistory(noInversion, rpgFinished);
        expect(
            await service.evaluateTemplate(noInversion, "off_the_map", {
                now: NOW,
            }),
        ).toBeNull();

        const newFrontier = await user();
        const frontierGame = await game();
        await linkGenre(frontierGame, shooter);
        await entry(newFrontier, frontierGame);
        expect(
            await service.evaluateTemplate(newFrontier, "off_the_map", {
                now: NOW,
            }),
        ).toMatchObject({ criteria: { genreIds: [shooter] } });
    });

    it("continue_the_saga surfaces an unfinished sequel of a finished franchise", async () => {
        const userId = await user();
        const saga = await resource("game_franchise", "The Saga");
        const otherSaga = await resource("game_franchise", "Other Saga");
        const finished = await game();
        const sequel = await game();
        const unrelated = await game();
        await linkFranchise(finished, saga);
        await linkFranchise(sequel, saga);
        await linkFranchise(unrelated, otherSaga);
        await finishHistory(userId, finished);
        await entry(userId, sequel);
        await entry(userId, unrelated);

        const quest = await service.evaluateTemplate(
            userId,
            "continue_the_saga",
            { now: NOW },
        );
        expect(quest).toEqual({
            eligible: true,
            criteria: { franchiseIds: [saga] },
            candidateGames: [{ gameId: sequel }],
            meta: { franchiseName: "The Saga" },
            template: expect.objectContaining({
                key: "continue_the_saga",
            }),
        });

        const onlyUnfinished = await user();
        const orphan = await game();
        await linkFranchise(orphan, saga);
        await entry(onlyUnfinished, orphan);
        expect(
            await service.evaluateTemplate(
                onlyUnfinished,
                "continue_the_saga",
                {
                    now: NOW,
                },
            ),
        ).toBeNull();
    });

    it("time_machine groups unfinished games into release decades", async () => {
        const userId = await user();
        const ninetiesA = await game({
            releasedAt: new Date("1994-05-01T00:00:00Z"),
        });
        const ninetiesB = await game({
            releasedAt: new Date("1998-01-15T00:00:00Z"),
        });
        const modern = await game({
            releasedAt: new Date("2015-10-01T00:00:00Z"),
        });
        for (const gameId of [ninetiesA, ninetiesB, modern])
            await entry(userId, gameId);

        const quest = await service.evaluateTemplate(userId, "time_machine", {
            now: NOW,
        });
        expect(quest).toMatchObject({
            criteria: { releaseYearMin: 1990, releaseYearMax: 1999 },
            meta: { decade: "1990s" },
        });
        expect(quest?.candidateGames.map((game) => game.gameId).sort()).toEqual(
            [ninetiesA, ninetiesB].sort(),
        );

        const lonelyDecade = await user();
        const onlyNineties = await game({
            releasedAt: new Date("1994-05-01T00:00:00Z"),
        });
        await entry(lonelyDecade, onlyNineties);
        expect(
            await service.evaluateTemplate(lonelyDecade, "time_machine", {
                now: NOW,
            }),
        ).toBeNull();
    });

    it("hidden_gem finds low-popularity and indie unfinished games", async () => {
        const obscureUser = await user();
        const obscure = await game({ ratingCount: 5 });
        await entry(obscureUser, obscure);
        const obscureQuest = await service.evaluateTemplate(
            obscureUser,
            "hidden_gem",
            { now: NOW },
        );
        expect(obscureQuest?.criteria.gameIds).toEqual([obscure]);
        expect(obscureQuest?.candidateGames).toEqual([{ gameId: obscure }]);

        const popularUser = await user();
        const popular = await game({ ratingCount: 5_000 });
        await entry(popularUser, popular);
        expect(
            await service.evaluateTemplate(popularUser, "hidden_gem", {
                now: NOW,
            }),
        ).toBeNull();

        const indieUser = await user();
        const indie = await game({ ratingCount: 5_000 });
        await source.query(
            "INSERT IGNORE INTO game_genre (id, name) VALUES (32, 'Indie')",
        );
        await linkGenre(indie, 32);
        await entry(indieUser, indie);
        expect(
            await service.evaluateTemplate(indieUser, "hidden_gem", {
                now: NOW,
            }),
        ).toMatchObject({ criteria: { gameIds: [indie] } });
    });

    it("return_to_the_world finds DLC, expansions, remakes and remasters", async () => {
        for (const table of [
            "game_dlcs_game",
            "game_expansions_game",
            "game_remakes_game",
            "game_remasters_game",
        ] as const) {
            const userId = await user();
            const base = await game();
            const related = await game();
            await finishHistory(userId, base);
            await entry(userId, related);
            await source.query(
                `INSERT INTO ${table} (gameId_1, gameId_2) VALUES (?, ?)`,
                [base, related],
            );

            const quest = await service.evaluateTemplate(
                userId,
                "return_to_the_world",
                { now: NOW },
            );
            expect(quest).toMatchObject({
                criteria: { gameIds: [related] },
                candidateGames: [{ gameId: related }],
            });
        }

        const noFinishedBase = await user();
        await entry(noFinishedBase, await game());
        expect(
            await service.evaluateTemplate(
                noFinishedBase,
                "return_to_the_world",
                {
                    now: NOW,
                },
            ),
        ).toBeNull();
    });

    it("the_colossus and colossus_legend use cached time-to-beat only", async () => {
        const userId = await user();
        const fortyHours = await game();
        const seventyHours = await game();
        const uncachedEpic = await game();
        await timeToBeat(fortyHours, 40);
        await timeToBeat(seventyHours, 70);
        for (const gameId of [fortyHours, seventyHours, uncachedEpic])
            await entry(userId, gameId);

        const colossus = await service.evaluateTemplate(
            userId,
            "the_colossus",
            { now: NOW },
        );
        expect(colossus?.criteria.minTimeToBeatHours).toBe(35);
        expect(colossus?.candidateGames).toEqual(
            expect.arrayContaining([
                { gameId: seventyHours, estimatedHours: 70 },
                { gameId: fortyHours, estimatedHours: 40 },
            ]),
        );
        expect(
            colossus?.candidateGames.map((game) => game.gameId),
        ).not.toContain(uncachedEpic);

        const legend = await service.evaluateTemplate(
            userId,
            "colossus_legend",
            { now: NOW },
        );
        expect(legend?.criteria.minTimeToBeatHours).toBe(60);
        expect(legend?.candidateGames).toEqual([
            { gameId: seventyHours, estimatedHours: 70 },
        ]);

        const shortUser = await user();
        const twentyHours = await game();
        await timeToBeat(twentyHours, 20);
        await entry(shortUser, twentyHours);
        expect(
            await service.evaluateTemplate(shortUser, "the_colossus", {
                now: NOW,
            }),
        ).toBeNull();
        expect(
            await service.evaluateTemplate(shortUser, "colossus_legend", {
                now: NOW,
            }),
        ).toBeNull();
    });

    it("genre_marathon requires three unfinished games in one genre", async () => {
        const userId = await user();
        const puzzle = await resource("game_genre", "Puzzle");
        for (let index = 0; index < 3; index++) {
            const gameId = await game();
            await linkGenre(gameId, puzzle);
            await entry(userId, gameId);
        }

        const quest = await service.evaluateTemplate(userId, "genre_marathon", {
            now: NOW,
        });
        expect(quest).toMatchObject({
            criteria: { genreIds: [puzzle] },
            meta: { genreName: "Puzzle" },
        });
        expect(quest?.candidateGames.length).toBeLessThanOrEqual(3);

        const twoGames = await user();
        for (let index = 0; index < 2; index++) {
            const gameId = await game();
            await linkGenre(gameId, puzzle);
            await entry(twoGames, gameId);
        }
        expect(
            await service.evaluateTemplate(twoGames, "genre_marathon", {
                now: NOW,
            }),
        ).toBeNull();
    });

    it("saga_trilogy prefers a franchise and falls back to themes", async () => {
        const franchiseUser = await user();
        const saga = await resource("game_franchise", "Trilogy Saga");
        for (let index = 0; index < 3; index++) {
            const gameId = await game();
            await linkFranchise(gameId, saga);
            await entry(franchiseUser, gameId);
        }
        const franchiseQuest = await service.evaluateTemplate(
            franchiseUser,
            "saga_trilogy",
            { now: NOW },
        );
        expect(franchiseQuest).toMatchObject({
            criteria: { franchiseIds: [saga] },
            meta: { franchiseName: "Trilogy Saga" },
        });

        const themeUser = await user();
        const theme = await resource("game_theme", "Space Opera");
        for (let index = 0; index < 3; index++) {
            const gameId = await game();
            await linkTheme(gameId, theme);
            await entry(themeUser, gameId);
        }
        const themeQuest = await service.evaluateTemplate(
            themeUser,
            "saga_trilogy",
            { now: NOW },
        );
        expect(themeQuest).toMatchObject({
            criteria: { themeIds: [theme] },
            meta: { themeName: "Space Opera" },
        });

        const twoGames = await user();
        for (let index = 0; index < 2; index++) {
            const gameId = await game();
            await linkFranchise(gameId, saga);
            await entry(twoGames, gameId);
        }
        expect(
            await service.evaluateTemplate(twoGames, "saga_trilogy", {
                now: NOW,
            }),
        ).toBeNull();
    });

    it("gates synced achievement templates on external achievement data", async () => {
        const userId = await user();
        expect(await service.hasSyncedExternalAchievements(userId)).toBe(false);
        expect(
            await service.evaluateTemplate(userId, "trophy_hunter", {
                now: NOW,
            }),
        ).toBeNull();
        expect(
            await service.evaluateTemplate(userId, "platinum_crown", {
                now: NOW,
            }),
        ).toBeNull();

        await syncedAchievement(userId, await game());
        expect(await service.hasSyncedExternalAchievements(userId)).toBe(true);
        expect(
            await service.evaluateTemplate(userId, "trophy_hunter", {
                now: NOW,
            }),
        ).toMatchObject({ eligible: true, criteria: {} });
        expect(
            await service.evaluateTemplate(userId, "platinum_crown", {
                now: NOW,
            }),
        ).toMatchObject({ eligible: true });

        const completionOnly = await user();
        await completionStatus(completionOnly, await game());
        expect(
            await service.hasSyncedExternalAchievements(completionOnly),
        ).toBe(true);
        expect(
            await service.evaluateTemplate(completionOnly, "platinum_crown", {
                now: NOW,
            }),
        ).toMatchObject({ eligible: true });
    });

    it("resolves short_caravan, backlog_taste_test, captains_log, pack_cleanup and deep_dive", async () => {
        const shortUser = await user();
        const shortGame = await game();
        await entry(shortUser, shortGame, {
            plannedAt: daysAgo(10),
            createdAt: daysAgo(10),
        });
        await timeToBeat(shortGame, 6);
        expect(
            await service.evaluateTemplate(shortUser, "short_caravan", {
                now: NOW,
            }),
        ).toMatchObject({
            criteria: { maxTimeToBeatHours: 8 },
            candidateGames: [{ gameId: shortGame, estimatedHours: 6 }],
        });

        const longUser = await user();
        const longGame = await game();
        await entry(longUser, longGame, {
            plannedAt: daysAgo(10),
            createdAt: daysAgo(10),
        });
        await timeToBeat(longGame, 20);
        expect(
            await service.evaluateTemplate(longUser, "short_caravan", {
                now: NOW,
            }),
        ).toBeNull();

        const tasteUser = await user();
        for (let index = 0; index < 2; index++)
            await entry(tasteUser, await game(), {
                plannedAt: daysAgo(10),
                createdAt: daysAgo(10),
            });
        const taste = await service.evaluateTemplate(
            tasteUser,
            "backlog_taste_test",
            { now: NOW },
        );
        expect(taste).toMatchObject({
            criteria: { minPlaytimeSecondsPerGame: 2_700 },
        });
        expect(taste?.candidateGames).toHaveLength(2);

        const onePlanned = await user();
        await entry(onePlanned, await game());
        expect(
            await service.evaluateTemplate(onePlanned, "backlog_taste_test", {
                now: NOW,
            }),
        ).toBeNull();

        const captain = await user();
        const finishedRecently = await game();
        await entry(captain, finishedRecently, {
            status: CollectionEntryStatus.FINISHED,
            createdAt: daysAgo(40),
            plannedAt: daysAgo(40),
            finishedAt: daysAgo(2),
        });
        expect(
            await service.evaluateTemplate(captain, "captains_log", {
                now: NOW,
            }),
        ).toMatchObject({
            criteria: { finishedInCurrentMonth: true },
            candidateGames: [{ gameId: finishedRecently }],
        });

        const staleCaptain = await user();
        const finishedLastMonth = await game();
        await entry(staleCaptain, finishedLastMonth, {
            status: CollectionEntryStatus.FINISHED,
            createdAt: daysAgo(60),
            plannedAt: daysAgo(60),
            finishedAt: daysAgo(40),
        });
        expect(
            await service.evaluateTemplate(staleCaptain, "captains_log", {
                now: NOW,
            }),
        ).toBeNull();

        const triageUser = await user();
        for (let index = 0; index < 3; index++)
            await entry(triageUser, await game(), {
                plannedAt: daysAgo(40),
                createdAt: daysAgo(40),
            });
        expect(
            await service.evaluateTemplate(triageUser, "pack_cleanup", {
                now: NOW,
            }),
        ).toMatchObject({ eligible: true });

        const twoStalePlanned = await user();
        for (let index = 0; index < 2; index++)
            await entry(twoStalePlanned, await game(), {
                plannedAt: daysAgo(40),
                createdAt: daysAgo(40),
            });
        expect(
            await service.evaluateTemplate(twoStalePlanned, "pack_cleanup", {
                now: NOW,
            }),
        ).toBeNull();

        const diver = await user();
        const playing = await game();
        await entry(diver, playing, {
            status: CollectionEntryStatus.PLAYING,
            createdAt: daysAgo(20),
            plannedAt: null,
            startedAt: daysAgo(2),
        });
        expect(
            await service.evaluateTemplate(diver, "deep_dive", {
                now: NOW,
            }),
        ).toMatchObject({ candidateGames: [{ gameId: playing }] });

        const idle = await user();
        await entry(idle, await game(), {
            status: CollectionEntryStatus.FINISHED,
            createdAt: daysAgo(20),
        });
        expect(
            await service.evaluateTemplate(idle, "deep_dive", { now: NOW }),
        ).toBeNull();
    });

    it("locks the Monthly Expedition below Rank C and falls back to deep_critic_anthology", async () => {
        const userId = await user();
        expect(
            await service.generateMonthlyExpedition(userId, GuildRank.E, {
                now: NOW,
            }),
        ).toBeNull();
        expect(
            await service.generateMonthlyExpedition(userId, GuildRank.D, {
                now: NOW,
            }),
        ).toBeNull();

        for (const rank of [
            GuildRank.C,
            GuildRank.B,
            GuildRank.A,
            GuildRank.S,
        ]) {
            const expedition = await service.generateMonthlyExpedition(
                userId,
                rank,
                { now: NOW },
            );
            expect(expedition).toMatchObject({
                slotIndex: 3,
                cycle: GuildBoardCycle.MONTHLY,
                periodKey: MONTH_KEY,
                template: expect.objectContaining({
                    key: "deep_critic_anthology",
                }),
                criteria: { minReviewChars: 250 },
                candidateGames: [],
                meta: null,
            });
        }

        const first = await service.generateMonthlyExpedition(
            userId,
            GuildRank.C,
            { now: NOW },
        );
        const second = await service.generateMonthlyExpedition(
            userId,
            GuildRank.C,
            { now: NOW },
        );
        expect(second).toEqual(first);
    });

    it("rolls Rank A expeditions for C-B and adds Rank S for A-S", async () => {
        const { userId } = await allMonthlyTemplatesUser();

        for (const rank of [GuildRank.C, GuildRank.B]) {
            const expedition = await service.generateMonthlyExpedition(
                userId,
                rank,
                { now: NOW },
            );
            expect(expedition?.template.rank).toBe(GuildRank.A);
            expect(expedition?.slotIndex).toBe(3);
            expect(expedition?.cycle).toBe(GuildBoardCycle.MONTHLY);
            expect(expedition?.periodKey).toBe(MONTH_KEY);
        }

        // A fixed user whose deterministic Monthly Expedition winner is Rank S.
        let rankSUserId = "";
        for (let index = 0; index < 500; index++) {
            const candidate = fixedUserId(index);
            if (
                expectedMonthlyWinner(candidate, GuildRank.A).rank ===
                GuildRank.S
            ) {
                rankSUserId = candidate;
                break;
            }
        }
        expect(rankSUserId).not.toBe("");

        await allMonthlyTemplatesUser(rankSUserId);
        const expected = expectedMonthlyWinner(rankSUserId, GuildRank.A);
        const expedition = await service.generateMonthlyExpedition(
            rankSUserId,
            GuildRank.A,
            { now: NOW },
        );
        expect(expedition?.template.key).toBe(expected.key);
        expect(expedition?.template.rank).toBe(GuildRank.S);
        expect(expedition?.periodKey).toBe(MONTH_KEY);
        expect(expedition?.candidateGames.length).toBeGreaterThan(0);

        // The same library stays in the Rank A pool for a Rank C member.
        const rankC = await service.generateMonthlyExpedition(
            rankSUserId,
            GuildRank.C,
            { now: NOW },
        );
        expect(rankC?.template.rank).toBe(GuildRank.A);

        // Rank S members share the Rank A + Rank S pool.
        const rankS = await service.generateMonthlyExpedition(
            rankSUserId,
            GuildRank.S,
            { now: NOW },
        );
        expect(rankS?.template.key).toBe(expected.key);
    });
});
