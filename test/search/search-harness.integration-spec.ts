import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { DataSource } from "typeorm";
import {
    createSearchTestApp,
    createSearchTestDataSource,
    execInSearchManticore,
    queryManticoreRaw,
    reindexSearchTables,
    REPO_ROOT,
    resetSearchTestTables,
    seedSearchFixtures,
    spawnReindexInManticore,
} from "./helpers/search-test-harness";

const execFileAsync = promisify(execFile);

jest.setTimeout(120000);

describe("Search MySQL/Manticore disposable fixture harness & document schema (3.2-3.6, 4.1-4.4)", () => {
    let dataSource: DataSource;
    let app: INestApplication;

    beforeAll(async () => {
        dataSource = await createSearchTestDataSource();
        app = await createSearchTestApp(dataSource);
    });

    afterAll(async () => {
        if (app) {
            await app.close();
        }
        if (dataSource?.isInitialized) {
            await dataSource.destroy();
        }
    });

    beforeEach(async () => {
        await resetSearchTestTables(dataSource);
    });

    it("3.2 builds initial games and users plain indexes from seeded MySQL tables using only this repository", async () => {
        await seedSearchFixtures(dataSource, {
            genres: [
                { id: 12, name: "Role-playing (RPG)" },
                { id: 31, name: "Adventure" },
            ],
            themes: [{ id: 1, name: "Action" }],
            platforms: [
                { id: 6, name: "PC (Microsoft Windows)", abbreviation: "PC" },
            ],
            keywords: [{ id: 101, name: "open world" }],
            games: [
                {
                    id: 1001,
                    name: "Elden Ring",
                    slug: "elden-ring",
                    category: 0,
                    status: 0,
                    firstReleaseDate: "2022-02-25 00:00:00",
                    coverUrl:
                        "//images.igdb.com/igdb/image/upload/t_thumb/co4jni.jpg",
                    alternativeNames: ["Great Rune"],
                    genreIds: [12, 31],
                    themeIds: [1],
                    platformIds: [6],
                    keywordIds: [101],
                    viewsCount: 500,
                    likesCount: 120,
                },
            ],
            profiles: [
                {
                    userId: "user-uuid-1001",
                    username: "tarnished_one",
                    bio: "private bio not indexed",
                },
            ],
        });

        const buildOutput = reindexSearchTables(["games", "users"]);
        expect(buildOutput).toContain("Completed index build for: games users");

        // Also verify initial build invocation through entrypoint.sh with CREATE_PLAIN_TABLES="games;users"
        const entrypointInitOutput = execInSearchManticore([
            "/bin/bash",
            "-c",
            'CREATE_PLAIN_TABLES="games;users" /etc/manticoresearch/entrypoint.sh true',
        ]);
        expect(entrypointInitOutput).toContain(
            "Completed index build for: games users",
        );

        const gamesResponse = await queryManticoreRaw({
            table: "games",
            query: { match_all: {} },
        });
        expect(gamesResponse.hits.total).toBe(1);
        expect(gamesResponse.hits.hits[0]._id).toBe(1001);
        expect(gamesResponse.hits.hits[0]._source.name).toBe("Elden Ring");

        const usersResponse = await queryManticoreRaw({
            table: "users",
            query: { match_all: {} },
        });
        expect(usersResponse.hits.total).toBe(1);
        expect(usersResponse.hits.hits[0]._source).toMatchObject({
            user_id: "user-uuid-1001",
            username: "tarnished_one",
        });
        expect(usersResponse.hits.hits[0]._source.bio).toBeUndefined();
    });

    it("3.3 retains sparse games with LEFT JOIN / zero popularity and preserves complete multi-value IDs and un-truncated labels on high-fanout games", async () => {
        const fanoutCount = 60;
        const genres = Array.from({ length: fanoutCount }, (_, i) => ({
            id: i + 1,
            name: `Genre Label Number ${String(i + 1).padStart(2, "0")} Extended Description`,
        }));
        const themes = Array.from({ length: fanoutCount }, (_, i) => ({
            id: i + 101,
            name: `Theme Label Number ${String(i + 1).padStart(2, "0")} Extended Description`,
        }));
        const platforms = Array.from({ length: fanoutCount }, (_, i) => ({
            id: i + 201,
            name: `Platform System Name ${String(i + 1).padStart(2, "0")} Extended Edition`,
            abbreviation: `PLT${String(i + 1).padStart(2, "0")}`,
        }));
        const keywords = Array.from({ length: fanoutCount }, (_, i) => ({
            id: i + 301,
            name: `keyword-tag-entry-${String(i + 1).padStart(2, "0")}-extended`,
        }));

        await seedSearchFixtures(dataSource, {
            genres,
            themes,
            platforms,
            keywords,
            games: [
                {
                    id: 2001,
                    name: "Sparse Catalog Entry",
                    slug: "sparse-catalog-entry",
                    category: 0,
                    status: 2,
                    firstReleaseDate: null,
                    coverUrl: null,
                    includeStatisticsRow: false,
                },
                {
                    id: 2002,
                    name: "High Fanout Compendium",
                    slug: "high-fanout-compendium",
                    category: 0,
                    status: 0,
                    firstReleaseDate: "2023-06-15 00:00:00",
                    coverUrl: "//images.igdb.com/igdb/image/upload/t_thumb/co9999.jpg",
                    alternativeNames: Array.from(
                        { length: 40 },
                        (_, i) =>
                            `Alternative Title Variant ${String(i + 1).padStart(2, "0")} Extended`,
                    ),
                    genreIds: genres.map((g) => g.id),
                    themeIds: themes.map((t) => t.id),
                    platformIds: platforms.map((p) => p.id),
                    keywordIds: keywords.map((k) => k.id),
                    viewsCount: 950,
                    likesCount: 88,
                },
            ],
        });

        reindexSearchTables(["games"]);

        // 1. Verify sparse game is retained with zero popularity and empty MVA arrays
        const sparseRes = await queryManticoreRaw({
            table: "games",
            query: {
                bool: {
                    must: [
                        {
                            match_phrase: {
                                "name,alternative_names":
                                    "^Sparse Catalog Entry",
                            },
                        },
                    ],
                },
            },
        });
        expect(sparseRes.hits.total).toBe(1);
        const sparseDoc = sparseRes.hits.hits[0]._source;
        expect(sparseDoc.num_views).toBe(0);
        expect(sparseDoc.num_likes).toBe(0);
        expect(sparseDoc.first_release_date).toBe(0);
        expect(sparseDoc.cover_url).toBe("");
        expect(sparseDoc.genre_ids).toEqual([]);
        expect(sparseDoc.theme_ids).toEqual([]);
        expect(sparseDoc.platform_ids).toEqual([]);

        // 2. Verify high-fanout game retains all 60 MVA IDs and un-truncated >1024-byte display strings
        const fanoutRes = await queryManticoreRaw({
            table: "games",
            query: {
                bool: {
                    must: [
                        { in: { genre_ids: [fanoutCount] } },
                        { in: { theme_ids: [100 + fanoutCount] } },
                        { in: { platform_ids: [200 + fanoutCount] } },
                    ],
                },
            },
        });
        expect(fanoutRes.hits.total).toBe(1);
        expect(fanoutRes.hits.hits[0]._id).toBe(2002);

        const fanoutDoc = fanoutRes.hits.hits[0]._source;
        expect(fanoutDoc.genre_ids).toHaveLength(fanoutCount);
        expect(fanoutDoc.theme_ids).toHaveLength(fanoutCount);
        expect(fanoutDoc.platform_ids).toHaveLength(fanoutCount);

        expect(fanoutDoc.genres_names.length).toBeGreaterThan(2000);
        expect(fanoutDoc.genres_names).toContain(
            genres[fanoutCount - 1].name,
        );
        expect(fanoutDoc.themes_names.length).toBeGreaterThan(2000);
        expect(fanoutDoc.themes_names).toContain(
            themes[fanoutCount - 1].name,
        );
        expect(fanoutDoc.platforms_names.length).toBeGreaterThan(2000);
        expect(fanoutDoc.platforms_names).toContain(
            platforms[fanoutCount - 1].name,
        );
        expect(fanoutDoc.platforms_abbreviations).toContain(
            platforms[fanoutCount - 1].abbreviation,
        );
        expect(fanoutDoc.keywords_names.length).toBeGreaterThan(1500);
        expect(fanoutDoc.keywords_names).toContain(
            keywords[fanoutCount - 1].name,
        );
    });

    it("3.4 resolves genres/themes/platforms by case-insensitive names, decimal IDs, and platform abbreviations with OR within field, AND across fields, and engine-level pagination", async () => {
        await seedSearchFixtures(dataSource, {
            genres: [
                { id: 12, name: "Role-playing (RPG)" },
                { id: 31, name: "Adventure" },
                { id: 5, name: "Shooter" },
            ],
            themes: [
                { id: 1, name: "Action" },
                { id: 17, name: "Fantasy" },
                { id: 18, name: "Science fiction" },
            ],
            platforms: [
                { id: 6, name: "PC (Microsoft Windows)", abbreviation: "PC" },
                { id: 48, name: "PlayStation 4", abbreviation: "PS4" },
                { id: 130, name: "Nintendo Switch", abbreviation: "Switch" },
            ],
            games: [
                // Non-matching games with very high views (to prove no post-pagination filtering in Node!)
                {
                    id: 3001,
                    name: "Quest Alpha Shooter",
                    slug: "quest-alpha-shooter",
                    category: 0,
                    status: 0,
                    genreIds: [5],
                    themeIds: [18],
                    platformIds: [6],
                    viewsCount: 9999,
                },
                {
                    id: 3002,
                    name: "Quest Beta Wrong Status",
                    slug: "quest-beta-wrong-status",
                    category: 0,
                    status: 4,
                    genreIds: [12],
                    themeIds: [17],
                    platformIds: [6],
                    viewsCount: 8888,
                },
                {
                    id: 3003,
                    name: "Quest Gamma Wrong Category",
                    slug: "quest-gamma-wrong-category",
                    category: 2,
                    status: 0,
                    genreIds: [12],
                    themeIds: [17],
                    platformIds: [6],
                    viewsCount: 7777,
                },
                // 3 matching games across OR branches of genre/theme/platform
                {
                    id: 3004,
                    name: "Quest One RPG PC",
                    slug: "quest-one-rpg-pc",
                    category: 0,
                    status: 0,
                    genreIds: [12],
                    themeIds: [17],
                    platformIds: [6],
                    viewsCount: 300,
                },
                {
                    id: 3005,
                    name: "Quest Two Adventure PS4",
                    slug: "quest-two-adventure-ps4",
                    category: 0,
                    status: 0,
                    genreIds: [31],
                    themeIds: [1],
                    platformIds: [48],
                    viewsCount: 200,
                },
                {
                    id: 3006,
                    name: "Quest Three RPG Switch",
                    slug: "quest-three-rpg-switch",
                    category: 0,
                    status: 0,
                    genreIds: [12, 31],
                    themeIds: [1, 17],
                    platformIds: [130],
                    viewsCount: 100,
                },
            ],
        });

        reindexSearchTables(["games"]);

        // 1. All 5 filter families active with mixed known/unknown values, case-insensitive names, decimal IDs, and platform abbreviations, paginated with limit 2
        const page1Res = await request(app.getHttpServer())
            .post("/search/games")
            .send({
                query: "Quest",
                category: [0],
                status: [0],
                genres: ["role-playing (rpg)", "31", "unknown-genre"],
                themes: ["FANTASY", "1", "nonexistent-theme"],
                platforms: ["pc (microsoft windows)", "ps4", "130", "999999"],
                page: 1,
                limit: 2,
            })
            .expect(200);

        expect(page1Res.body.data.items.map((g: any) => g.id)).toEqual([
            3004, 3005,
        ]);
        expect(page1Res.body.pagination).toEqual({
            totalItems: 3,
            totalPages: 2,
            hasNextPage: true,
        });

        const page2Res = await request(app.getHttpServer())
            .post("/v1/search/games")
            .send({
                query: "Quest",
                category: [0],
                status: [0],
                genres: ["role-playing (rpg)", "31", "unknown-genre"],
                themes: ["FANTASY", "1", "nonexistent-theme"],
                platforms: ["pc (microsoft windows)", "ps4", "130", "999999"],
                page: 2,
                limit: 2,
            })
            .expect(200);

        expect(page2Res.body.data.items.map((g: any) => g.id)).toEqual([3006]);
        expect(page2Res.body.pagination).toEqual({
            totalItems: 3,
            totalPages: 2,
            hasNextPage: false,
        });

        // 2. Entirely unresolved populated filter short-circuits to empty result
        const unresolvedRes = await request(app.getHttpServer())
            .post("/search/games")
            .send({
                query: "Quest",
                genres: ["role-playing (rpg)"],
                platforms: ["completely-unknown-platform"],
            })
            .expect(200);

        expect(unresolvedRes.body).toEqual({
            data: {
                items: [],
                took: 0,
            },
            pagination: {
                totalItems: 0,
                totalPages: 0,
                hasNextPage: false,
            },
        });

        // 3. Empty arrays do not filter out results
        const emptyArraysRes = await request(app.getHttpServer())
            .post("/search/games")
            .send({
                query: "Quest",
                genres: [],
                themes: [],
                platforms: [],
            })
            .expect(200);

        expect(emptyArraysRes.body.pagination.totalItems).toBe(6);
    });

    it("3.5 configures UTC game/user schedules inside the single Manticore owner, serializes overlapping manual/scheduled rebuilds via shared flock, and does not duplicate rebuilds across two API replicas", async () => {
        await seedSearchFixtures(dataSource, {
            games: [
                {
                    id: 3501,
                    name: "Schedule Test Game",
                    slug: "schedule-test-game",
                },
            ],
            profiles: [
                {
                    userId: "user-schedule-1",
                    username: "schedule_user",
                },
            ],
        });

        // 1. Run entrypoint.sh with production CREATE_PLAIN_TABLES schedule and verify installed crontab in the container
        const scheduleInitOutput = execInSearchManticore([
            "/bin/bash",
            "-c",
            'CREATE_PLAIN_TABLES="games;users;games:0 3 * * *;users:0 * * * *" /etc/manticoresearch/entrypoint.sh true',
        ]);
        expect(scheduleInitOutput).toContain(
            "Completed index build for: games users",
        );

        const installedCrontab = execInSearchManticore([
            "crontab",
            "-u",
            "manticore",
            "-l",
        ]);
        expect(installedCrontab).toContain("TZ=UTC");
        expect(installedCrontab).toContain(
            "0 3 * * * /bin/bash /etc/manticoresearch/reindex.sh games >> /proc/1/fd/1 2>&1",
        );
        expect(installedCrontab).toContain(
            "0 * * * * /bin/bash /etc/manticoresearch/reindex.sh users >> /proc/1/fd/1 2>&1",
        );

        // 2. Verify overlapping manual (root or manticore) and scheduled commands share non-overlap flock protection
        const firstBuildPromise = spawnReindexInManticore(["games"], {
            MANTICORE_REINDEX_HOLD_SECONDS: "2",
        });

        // Wait briefly for the first process to acquire the flock
        await new Promise((r) => setTimeout(r, 400));

        // Second concurrent invocation (simulating overlapping cron/manual command) must fail fast with lock error
        const overlappingBuild = await spawnReindexInManticore(["users"]);
        const firstBuild = await firstBuildPromise;

        expect(firstBuild.code).toBe(0);
        expect(firstBuild.output).toContain("Completed index build for: games");
        expect(overlappingBuild.code).toBe(1);
        expect(overlappingBuild.output).toContain(
            "another index rebuild is already in progress",
        );

        // 3. Verify two independent Nest API replicas serve search without registering duplicate index rebuild jobs
        const replica2 = await createSearchTestApp(dataSource);
        try {
            const [res1, res2] = await Promise.all([
                request(app.getHttpServer())
                    .post("/search/games")
                    .send({ query: "Schedule Test" })
                    .expect(200),
                request(replica2.getHttpServer())
                    .post("/v1/search/games")
                    .send({ query: "Schedule Test" })
                    .expect(200),
            ]);

            expect(res1.body.data.items.map((g: any) => g.id)).toEqual([3501]);
            expect(res2.body.data.items.map((g: any) => g.id)).toEqual([3501]);
        } finally {
            await replica2.close();
        }
    });

    it("3.6 preserves searchable last-good indexes when MySQL source fails during rotation, logs failure, recovers on manual retry, and exposes game updates + profile rename/deletion with stable public userIds", async () => {
        await seedSearchFixtures(dataSource, {
            games: [
                {
                    id: 4001,
                    name: "Original Vanguard",
                    slug: "original-vanguard",
                    viewsCount: 15,
                },
            ],
            profiles: [
                {
                    userId: "user-stable-uuid-1",
                    username: "alphavanguard",
                },
                {
                    userId: "user-ephemeral-uuid-2",
                    username: "ephemeralnomad",
                },
            ],
        });

        reindexSearchTables(["games", "users"]);

        // Confirm initial state is searchable
        const initialGames = await request(app.getHttpServer())
            .post("/search/games")
            .send({ query: "Original Vanguard" })
            .expect(200);
        expect(initialGames.body.data.items).toHaveLength(1);
        expect(initialGames.body.data.items[0].name).toBe("Original Vanguard");
        expect(initialGames.body.data.items[0].numViews).toBe(15);

        const initialUsers = await request(app.getHttpServer())
            .post("/search/users")
            .send({ query: "alphavanguard" })
            .expect(200);
        expect(initialUsers.body.data.items).toEqual([
            {
                userId: "user-stable-uuid-1",
                username: "alphavanguard",
            },
        ]);

        // 1. Trigger a rotation rebuild against an unreachable MySQL source and verify it fails & logs error
        execInSearchManticore(
            [
                "/bin/bash",
                "-c",
                "MANTICORE_RENDER_ONLY=1 MANTICORE_CONFIG_PATH=/var/run/manticore/broken-source.conf DB_HOST=127.0.0.1 DB_PORT=65432 /etc/manticoresearch/entrypoint.sh",
            ],
            { user: "manticore" },
        );

        const failedRebuild = await spawnReindexInManticore(
            ["games", "users"],
            {
                MANTICORE_CONFIG_FILE:
                    "/var/run/manticore/broken-source.conf",
            },
        );
        expect(failedRebuild.code).toBe(1);
        expect(failedRebuild.output).toContain(
            "ERROR: table 'games': sql_connect",
        );
        expect(failedRebuild.output).toContain(
            "ERROR: index build failed for: games users",
        );

        // 2. Verify last-good serving indexes remain searchable after the failed rotation
        const gamesDuringOutage = await request(app.getHttpServer())
            .post("/search/games")
            .send({ query: "Original Vanguard" })
            .expect(200);
        expect(gamesDuringOutage.body.data.items).toHaveLength(1);
        expect(gamesDuringOutage.body.data.items[0].id).toBe(4001);

        const usersDuringOutage = await request(app.getHttpServer())
            .post("/search/users")
            .send({ query: "alphavanguard" })
            .expect(200);
        expect(usersDuringOutage.body.data.items).toEqual([
            {
                userId: "user-stable-uuid-1",
                username: "alphavanguard",
            },
        ]);

        // 3. Apply game update, profile rename, profile deletion, and insert a lower-sorting userId to shift ROW_NUMBER()
        await dataSource.query(
            "UPDATE `game` SET `name` = ?, `slug` = ? WHERE `id` = ?",
            ["Reforged Vanguard", "reforged-vanguard", 4001],
        );
        await dataSource.query(
            "UPDATE `game_statistics` SET `viewsCount` = ? WHERE `gameId` = ?",
            [250, 4001],
        );
        await dataSource.query(
            "UPDATE `profile` SET `username` = ? WHERE `userId` = ?",
            ["vanguardrenamed", "user-stable-uuid-1"],
        );
        await dataSource.query("DELETE FROM `profile` WHERE `userId` = ?", [
            "user-ephemeral-uuid-2",
        ]);
        await dataSource.query(
            "INSERT INTO `profile` (`userId`, `username`, `createdAt`, `updatedAt`) VALUES (?, ?, '2024-01-01 00:00:00', '2024-01-01 00:00:00')",
            ["0000-preceding-uuid", "vanguardfirst"],
        );

        // 4. Manual retry against healthy MySQL source succeeds and rotates both indexes
        const retryOutput = reindexSearchTables(["games", "users"]);
        expect(retryOutput).toContain(
            "Completed index build for: games users",
        );

        // Old game title no longer matches; updated game title and views are served
        const oldTitleRes = await request(app.getHttpServer())
            .post("/search/games")
            .send({ query: "Original Vanguard" })
            .expect(200);
        expect(oldTitleRes.body.data.items).toEqual([]);

        const updatedTitleRes = await request(app.getHttpServer())
            .post("/search/games")
            .send({ query: "Reforged Vanguard" })
            .expect(200);
        expect(updatedTitleRes.body.data.items).toHaveLength(1);
        expect(updatedTitleRes.body.data.items[0]).toMatchObject({
            id: 4001,
            name: "Reforged Vanguard",
            slug: "reforged-vanguard",
            numViews: 250,
        });

        // Deleted profile is gone; renamed profile retains its exact public userId despite internal ROW_NUMBER() shift
        const deletedUserRes = await request(app.getHttpServer())
            .post("/search/users")
            .send({ query: "ephemeralnomad" })
            .expect(200);
        expect(deletedUserRes.body.data.items).toEqual([]);
        expect(deletedUserRes.body.pagination.totalItems).toBe(0);

        const renamedUserRes = await request(app.getHttpServer())
            .post("/search/users")
            .send({ query: "vanguard" })
            .expect(200);
        expect(renamedUserRes.body.data.items).toEqual([
            {
                userId: "0000-preceding-uuid",
                username: "vanguardfirst",
            },
            {
                userId: "user-stable-uuid-1",
                username: "vanguardrenamed",
            },
        ]);
    });

    it("4.1 passes engine-backed HTTP contract checks for game search, autocomplete, and users (alternative names, accented/quoted/punctuated titles, wildcard input, deterministic ties, legacy vs v1 parity, and intentional fixes)", async () => {
        const profiles = Array.from({ length: 21 }, (_, i) => ({
            userId: `user-contract-${String(i + 1).padStart(2, "0")}`,
            username: `contractplayer${String(i + 1).padStart(2, "0")}`,
            bio: "should never appear in search response",
        }));

        await seedSearchFixtures(dataSource, {
            genres: [
                { id: 12, name: "Role-playing (RPG)" },
                { id: 31, name: "Adventure" },
            ],
            themes: [{ id: 1, name: "Action" }],
            platforms: [
                { id: 6, name: "PC (Microsoft Windows)", abbreviation: "PC" },
                { id: 48, name: "PlayStation 4", abbreviation: "PS4" },
            ],
            keywords: [{ id: 501, name: "survival horror" }],
            games: [
                {
                    id: 5001,
                    name: "Resident Evil 4",
                    slug: "resident-evil-4",
                    category: 0,
                    status: 0,
                    firstReleaseDate: "2005-01-11 00:00:00",
                    coverUrl:
                        "//images.igdb.com/igdb/image/upload/t_thumb/co1r7h.jpg",
                    alternativeNames: ["Biohazard 4"],
                    genreIds: [31],
                    themeIds: [1],
                    platformIds: [6, 48],
                    keywordIds: [501],
                    viewsCount: 400,
                    likesCount: 95,
                },
                {
                    id: 5002,
                    name: "Pok\u00e9mon Emerald",
                    slug: "pokemon-emerald",
                    category: 0,
                    status: 0,
                    firstReleaseDate: "2004-09-16 00:00:00",
                    genreIds: [12],
                    viewsCount: 300,
                },
                {
                    id: 5003,
                    name: 'Sid Meier\'s Civilization VI: "Gathering Storm"',
                    slug: "sid-meiers-civilization-vi-gathering-storm",
                    category: 2,
                    status: 0,
                    firstReleaseDate: "2019-02-14 00:00:00",
                    platformIds: [6],
                    viewsCount: 200,
                },
                // Deterministic tie-breaking fixtures for "Nexus Chronicle"
                {
                    id: 5010,
                    name: "Nexus Chronicle Alpha",
                    slug: "nexus-chronicle-alpha",
                    category: 0,
                    status: 0,
                    firstReleaseDate: "2020-01-01 00:00:00",
                    viewsCount: 500,
                },
                {
                    id: 5011,
                    name: "Nexus Chronicle Beta",
                    slug: "nexus-chronicle-beta",
                    category: 0,
                    status: 0,
                    firstReleaseDate: "2023-06-01 00:00:00",
                    viewsCount: 100,
                },
                {
                    id: 5012,
                    name: "Nexus Chronicle Gamma",
                    slug: "nexus-chronicle-gamma",
                    category: 0,
                    status: 0,
                    firstReleaseDate: "2021-01-01 00:00:00",
                    viewsCount: 100,
                },
                {
                    id: 5013,
                    name: "Nexus Chronicle Delta",
                    slug: "nexus-chronicle-delta",
                    category: 0,
                    status: 0,
                    firstReleaseDate: "2021-01-01 00:00:00",
                    viewsCount: 100,
                },
            ],
            profiles,
        });

        reindexSearchTables(["games", "users"]);

        // A. Legacy-compatible contract: alternative name match + flattened game payload + neutral vs v1 route parity
        const [altNeutral, altV1] = await Promise.all([
            request(app.getHttpServer())
                .post("/search/games")
                .send({ query: "Biohazard 4" })
                .expect(200),
            request(app.getHttpServer())
                .post("/v1/search/games")
                .send({ query: "Biohazard 4" })
                .expect(200),
        ]);

        expect(altNeutral.body.data.items).toEqual(altV1.body.data.items);
        expect(altNeutral.body.pagination).toEqual(altV1.body.pagination);
        expect(altNeutral.body.data.items).toEqual([
            {
                id: 5001,
                name: "Resident Evil 4",
                slug: "resident-evil-4",
                category: 0,
                status: 0,
                firstReleaseDate: "2005-01-11T00:00:00.000Z",
                createdAt: "2024-01-01T00:00:00.000Z",
                updatedAt: "2024-01-02T00:00:00.000Z",
                coverUrl:
                    "//images.igdb.com/igdb/image/upload/t_thumb/co1r7h.jpg",
                genresNames: "Adventure",
                themesNames: "Action",
                platformsNames: "PC (Microsoft Windows), PlayStation 4",
                platformsAbbreviations: "PC, PS4",
                keywordsNames: "survival horror",
                numLikes: 95,
                numViews: 400,
                source: "manticore",
            },
        ]);

        // B. Accented, apostrophe, and quoted game titles
        const accentedRes = await request(app.getHttpServer())
            .post("/search/games")
            .send({ query: "Pok\u00e9mon" })
            .expect(200);
        expect(accentedRes.body.data.items.map((g: any) => g.id)).toEqual([
            5002,
        ]);

        const quotedRes = await request(app.getHttpServer())
            .post("/search/games")
            .send({ query: "Sid Meier's Civilization VI" })
            .expect(200);
        expect(quotedRes.body.data.items.map((g: any) => g.id)).toEqual([5003]);

        // C. Wildcard input handling across all 3 endpoints
        const wildcardGameRes = await request(app.getHttpServer())
            .post("/search/games")
            .send({ query: "Resident*" })
            .expect(200);
        expect(wildcardGameRes.body.data.items.map((g: any) => g.id)).toEqual([
            5001,
        ]);

        const [autoNeutral, autoV1] = await Promise.all([
            request(app.getHttpServer())
                .post("/search/games/autocomplete")
                .send({ query: "Nexus", page: 3, limit: 100 })
                .expect(200),
            request(app.getHttpServer())
                .post("/v1/search/games/autocomplete")
                .send({ query: "Nexus", page: 3, limit: 100 })
                .expect(200),
        ]);
        expect(autoNeutral.body).toEqual(autoV1.body);
        expect(autoNeutral.body).toEqual({
            data: [
                "Nexus Chronicle Alpha",
                "Nexus Chronicle Beta",
                "Nexus Chronicle Gamma",
                "Nexus Chronicle Delta",
            ],
            total: 4,
        });

        // D. Deterministic tie-breaking: _score DESC -> num_views DESC -> first_release_date DESC -> id ASC
        const tieRes = await request(app.getHttpServer())
            .post("/search/games")
            .send({ query: "Nexus Chronicle" })
            .expect(200);
        expect(tieRes.body.data.items.map((g: any) => g.id)).toEqual([
            5010, 5011, 5012, 5013,
        ]);

        // E. Intentional fixes verified separately from legacy behavior:
        // 1. User search page 2 of 21 results (limit 20) reports hasNextPage: false (legacy bug reported true)
        const [usersPage1, usersPage2Neutral, usersPage2V1] = await Promise.all(
            [
                request(app.getHttpServer())
                    .post("/search/users")
                    .send({ query: "contractplayer", page: 1, limit: 20 })
                    .expect(200),
                request(app.getHttpServer())
                    .post("/search/users")
                    .send({ query: "contractplayer", page: 2, limit: 20 })
                    .expect(200),
                request(app.getHttpServer())
                    .post("/v1/search/users")
                    .send({ query: "contractplayer", page: 2, limit: 20 })
                    .expect(200),
            ],
        );
        expect(usersPage1.body.pagination).toEqual({
            totalItems: 21,
            totalPages: 2,
            hasNextPage: true,
        });
        expect(usersPage2Neutral.body.data.items).toEqual(
            usersPage2V1.body.data.items,
        );
        expect(usersPage2Neutral.body.data.items).toEqual([
            {
                userId: "user-contract-21",
                username: "contractplayer21",
            },
        ]);
        expect(usersPage2Neutral.body.pagination).toEqual({
            totalItems: 21,
            totalPages: 2,
            hasNextPage: false,
        });
    });

    it("4.2 returns exact filtered totals and deep pages above Manticore 7.4.6's default 1000-result window without lower-bound truncation", async () => {
        await seedSearchFixtures(dataSource, {
            genres: [{ id: 12, name: "Role-playing (RPG)" }],
            platforms: [
                { id: 6, name: "PC (Microsoft Windows)", abbreviation: "PC" },
            ],
        });

        // Bulk-insert 1,150 matching games (id 1..1150) + 100 non-matching games (id 1151..1250)
        const matchingCount = 1150;
        const nonMatchingCount = 100;
        const totalSeeded = matchingCount + nonMatchingCount;
        const batchSize = 250;

        for (let start = 1; start <= totalSeeded; start += batchSize) {
            const end = Math.min(start + batchSize - 1, totalSeeded);
            const gameValues: string[] = [];
            const genreRelValues: string[] = [];
            const platRelValues: string[] = [];
            const statValues: string[] = [];

            for (let id = start; id <= end; id++) {
                const isMatching = id <= matchingCount;
                const category = isMatching ? 0 : 2;
                const views = isMatching ? 20000 - id : 50000;
                gameValues.push(
                    `(${id}, 'Deep Window Game ${id}', 'deep-window-game-${id}', ${category}, 0, '2022-01-01 00:00:00', '2024-01-01 00:00:00', '2024-01-01 00:00:00')`,
                );
                if (isMatching) {
                    genreRelValues.push(`(${id}, 12)`);
                    platRelValues.push(`(6, ${id})`);
                }
                statValues.push(`(${id}, ${views}, 1)`);
            }

            await dataSource.query(
                `INSERT INTO \`game\` (\`id\`, \`name\`, \`slug\`, \`category\`, \`status\`, \`firstReleaseDate\`, \`createdAt\`, \`updatedAt\`) VALUES ${gameValues.join(", ")}`,
            );
            if (genreRelValues.length > 0) {
                await dataSource.query(
                    `INSERT INTO \`game_genres_game_genre\` (\`gameId\`, \`gameGenreId\`) VALUES ${genreRelValues.join(", ")}`,
                );
            }
            if (platRelValues.length > 0) {
                await dataSource.query(
                    `INSERT INTO \`game_platform_games_game\` (\`gamePlatformId\`, \`gameId\`) VALUES ${platRelValues.join(", ")}`,
                );
            }
            await dataSource.query(
                `INSERT INTO \`game_statistics\` (\`gameId\`, \`viewsCount\`, \`likesCount\`) VALUES ${statValues.join(", ")}`,
            );
        }

        reindexSearchTables(["games"]);

        // Request page 11 (offset 1000, limit 100 -> items 1001..1100)
        const page11Res = await request(app.getHttpServer())
            .post("/search/games")
            .send({
                query: "Deep Window Game",
                category: [0],
                genres: ["Role-playing (RPG)"],
                platforms: ["PC"],
                page: 11,
                limit: 100,
            })
            .expect(200);

        expect(page11Res.body.data.items).toHaveLength(100);
        expect(page11Res.body.data.items[0].id).toBe(1001);
        expect(page11Res.body.data.items[99].id).toBe(1100);
        expect(page11Res.body.pagination).toEqual({
            totalItems: 1150,
            totalPages: 12,
            hasNextPage: true,
        });

        // Request deep page 12 (offset 1100, limit 100 -> items 1101..1150, beyond default 1000 window)
        const page12Res = await request(app.getHttpServer())
            .post("/search/games")
            .send({
                query: "Deep Window Game",
                category: [0],
                genres: ["Role-playing (RPG)"],
                platforms: ["PC"],
                page: 12,
                limit: 100,
            })
            .expect(200);

        expect(page12Res.body.data.items).toHaveLength(50);
        expect(page12Res.body.data.items[0].id).toBe(1101);
        expect(page12Res.body.data.items[49].id).toBe(1150);
        expect(page12Res.body.pagination).toEqual({
            totalItems: 1150,
            totalPages: 12,
            hasNextPage: false,
        });
    });

    it("4.3 serves combined ordinary API/MySQL and Manticore search requests concurrently during an index rebuild with zero errors and bounded latency/resource usage", async () => {
        await seedSearchFixtures(dataSource, {
            genres: [
                { id: 12, name: "Role-playing (RPG)" },
                { id: 31, name: "Adventure" },
            ],
            platforms: [
                { id: 6, name: "PC (Microsoft Windows)", abbreviation: "PC" },
            ],
        });

        // Seed 500 games and 200 profiles for realistic local rebuild work
        const gameValues: string[] = [];
        const genreRelValues: string[] = [];
        const statValues: string[] = [];
        for (let id = 1; id <= 500; id++) {
            gameValues.push(
                `(${id}, 'Load Check Game ${id}', 'load-check-game-${id}', 0, 0, '2023-01-01 00:00:00', '2024-01-01 00:00:00', '2024-01-01 00:00:00')`,
            );
            genreRelValues.push(`(${id}, ${id % 2 === 0 ? 12 : 31})`);
            statValues.push(`(${id}, ${1000 - id}, 10)`);
        }
        await dataSource.query(
            `INSERT INTO \`game\` (\`id\`, \`name\`, \`slug\`, \`category\`, \`status\`, \`firstReleaseDate\`, \`createdAt\`, \`updatedAt\`) VALUES ${gameValues.join(", ")}`,
        );
        await dataSource.query(
            `INSERT INTO \`game_genres_game_genre\` (\`gameId\`, \`gameGenreId\`) VALUES ${genreRelValues.join(", ")}`,
        );
        await dataSource.query(
            `INSERT INTO \`game_statistics\` (\`gameId\`, \`viewsCount\`, \`likesCount\`) VALUES ${statValues.join(", ")}`,
        );

        const profileValues: string[] = [];
        for (let i = 1; i <= 200; i++) {
            profileValues.push(
                `('load-user-${i}', 'loadplayer${i}', '2024-01-01 00:00:00', '2024-01-01 00:00:00')`,
            );
        }
        await dataSource.query(
            `INSERT INTO \`profile\` (\`userId\`, \`username\`, \`createdAt\`, \`updatedAt\`) VALUES ${profileValues.join(", ")}`,
        );

        reindexSearchTables(["games", "users"]);

        const memBefore = process.memoryUsage();
        const cpuBefore = process.cpuUsage();
        const rebuildStart = Date.now();

        // Start live rotation rebuild in background while driving mixed ordinary MySQL + search HTTP load
        const rebuildPromise = spawnReindexInManticore(["games", "users"]);

        const latenciesMs: number[] = [];
        const totalIterations = 20;

        for (let i = 0; i < totalIterations; i++) {
            const batchStart = Date.now();
            const [gameRes, autoRes, userRes, dbRows] = await Promise.all([
                request(app.getHttpServer())
                    .post("/search/games")
                    .send({
                        query: "Load Check",
                        genres: ["Role-playing (RPG)"],
                        page: 1,
                        limit: 20,
                    })
                    .expect(200),
                request(app.getHttpServer())
                    .post("/search/games/autocomplete")
                    .send({ query: "Load Check" })
                    .expect(200),
                request(app.getHttpServer())
                    .post("/search/users")
                    .send({ query: "loadplayer", page: 1, limit: 20 })
                    .expect(200),
                // Ordinary API MySQL catalog query executed concurrently on the same DataSource
                dataSource.query(
                    "SELECT id, name FROM `game` WHERE `category` = 0 ORDER BY `id` ASC LIMIT 20",
                ),
            ]);
            latenciesMs.push(Date.now() - batchStart);

            expect(gameRes.body.pagination.totalItems).toBe(250);
            expect(autoRes.body.total).toBe(5);
            expect(userRes.body.pagination.totalItems).toBe(200);
            expect(dbRows).toHaveLength(20);
        }

        const rebuildResult = await rebuildPromise;
        const rebuildDurationMs = Date.now() - rebuildStart;
        const cpuAfter = process.cpuUsage(cpuBefore);
        const memAfter = process.memoryUsage();

        expect(rebuildResult.code).toBe(0);
        expect(rebuildResult.output).toContain(
            "Completed index build for: games users",
        );

        const sortedLatencies = [...latenciesMs].sort((a, b) => a - b);
        const p50Ms =
            sortedLatencies[Math.floor(sortedLatencies.length * 0.5)];
        const p95Ms =
            sortedLatencies[Math.floor(sortedLatencies.length * 0.95)];
        const maxMs = sortedLatencies[sortedLatencies.length - 1];

        // Ensure bounded latency and memory
        expect(maxMs).toBeLessThan(5000);
        expect(p50Ms).toBeGreaterThanOrEqual(0);
        expect(p95Ms).toBeGreaterThanOrEqual(p50Ms);
        expect(rebuildDurationMs).toBeGreaterThan(0);
        expect(memAfter.heapUsed).toBeGreaterThan(0);
        expect(cpuAfter.user + cpuAfter.system).toBeGreaterThan(0);
        expect(memBefore.rss).toBeGreaterThan(0);
    });

    it("4.4 verifies the delivered cutover/rollback runbook and executes its exact curl smoke commands against the disposable deployment", async () => {
        const runbookPath = path.join(
            REPO_ROOT,
            "docs/search-cutover-runbook.md",
        );
        expect(fs.existsSync(runbookPath)).toBe(true);
        const runbookContent = fs.readFileSync(runbookPath, "utf8");
        expect(runbookContent).toContain(
            "Production actions NOT executed during code implementation",
        );
        expect(runbookContent).toContain("Stage on a Separate Index Volume");
        expect(runbookContent).toContain(
            "Legacy Web, Mobile, and Admin Smoke Checks",
        );
        expect(runbookContent).toContain(
            "Old-Host Path-Preserving Reverse-Proxy Routing",
        );
        expect(runbookContent).toContain(
            "Observed Scheduled-Refresh Gates & Go-Replica Retirement",
        );
        expect(runbookContent).toContain("Rollback Procedure");

        await seedSearchFixtures(dataSource, {
            genres: [{ id: 12, name: "Role-playing (RPG)" }],
            platforms: [
                { id: 6, name: "PC (Microsoft Windows)", abbreviation: "PC" },
            ],
            games: [
                {
                    id: 1001,
                    name: "Elden Ring",
                    slug: "elden-ring",
                    category: 0,
                    status: 0,
                    genreIds: [12],
                    platformIds: [6],
                    viewsCount: 500,
                },
            ],
            profiles: [
                {
                    userId: "user-uuid-1001",
                    username: "tarnished_one",
                },
            ],
        });

        reindexSearchTables(["games", "users"]);

        const httpServer = await app.listen(0, "127.0.0.1");
        const address = httpServer.address();
        const port = typeof address === "object" && address ? address.port : 0;
        const apiUrl = `http://127.0.0.1:${port}`;

        const runCurl = async (args: string[]) => {
            const { stdout } = await execFileAsync("curl", args);
            return stdout;
        };

        const optionsOut = await runCurl([
            "-i",
            "-sS",
            "-X",
            "OPTIONS",
            `${apiUrl}/search/games`,
            "-H",
            "Origin: https://gamenode.app",
            "-H",
            "Access-Control-Request-Method: POST",
            "-H",
            "Access-Control-Request-Headers: content-type",
        ]);
        expect(optionsOut).toMatch(/access-control-allow-origin/i);

        const gamesNeutral = JSON.parse(
            await runCurl([
                "-sS",
                "-X",
                "POST",
                `${apiUrl}/search/games`,
                "-H",
                "Content-Type: application/json",
                "-d",
                '{"query":"Elden Ring","category":[0],"status":[0],"genres":["Role-playing (RPG)"],"platforms":["PC"],"page":1,"limit":20}',
            ]),
        );
        const gamesV1 = JSON.parse(
            await runCurl([
                "-sS",
                "-X",
                "POST",
                `${apiUrl}/v1/search/games`,
                "-H",
                "Content-Type: application/json",
                "-d",
                '{"query":"Elden Ring","category":[0],"status":[0],"genres":["Role-playing (RPG)"],"platforms":["PC"],"page":1,"limit":20}',
            ]),
        );
        expect(gamesNeutral.data.items).toHaveLength(1);
        expect(gamesNeutral.data.items).toEqual(gamesV1.data.items);

        const autoNeutral = JSON.parse(
            await runCurl([
                "-sS",
                "-X",
                "POST",
                `${apiUrl}/search/games/autocomplete`,
                "-H",
                "Content-Type: application/json",
                "-d",
                '{"query":"Elden"}',
            ]),
        );
        const autoV1 = JSON.parse(
            await runCurl([
                "-sS",
                "-X",
                "POST",
                `${apiUrl}/v1/search/games/autocomplete`,
                "-H",
                "Content-Type: application/json",
                "-d",
                '{"query":"Elden"}',
            ]),
        );
        expect(autoNeutral).toEqual({ data: ["Elden Ring"], total: 1 });
        expect(autoV1).toEqual(autoNeutral);

        const usersNeutral = JSON.parse(
            await runCurl([
                "-sS",
                "-X",
                "POST",
                `${apiUrl}/search/users`,
                "-H",
                "Content-Type: application/json",
                "-d",
                '{"query":"tarnished","page":1,"limit":20}',
            ]),
        );
        const usersV1 = JSON.parse(
            await runCurl([
                "-sS",
                "-X",
                "POST",
                `${apiUrl}/v1/search/users`,
                "-H",
                "Content-Type: application/json",
                "-d",
                '{"query":"tarnished","page":1,"limit":20}',
            ]),
        );
        expect(usersNeutral.data.items).toEqual([
            {
                userId: "user-uuid-1001",
                username: "tarnished_one",
            },
        ]);
        expect(usersV1.data.items).toEqual(usersNeutral.data.items);
    });
});
