import { DataSource, QueryRunner } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { addDays, DailyMode, dailyToday, mondayOf } from "./daily.constants";
import { DailyPoolService, WEEKLY_POOL_WINDOW } from "./daily-pool.service";

const id = 987654321;
const date = "2099-01-01";
// Above the fixture in critic count, so with the weekly window the fixture sits at pool position 501.
const DEEP_POOL_ID = 988_500_000;

describe("DailyPoolService on MySQL", () => {
    let db: DataSource;
    let tx: QueryRunner;
    let pool: DailyPoolService;
    const query = (sql: string, params: unknown[] = []) =>
        tx.query(sql, params);
    const pick = (mode = DailyMode.COVER) => pool.pick(mode, date);
    const pickWeekly = (mode = DailyMode.COVER) =>
        pool.pick(mode, date, WEEKLY_POOL_WINDOW);
    const pickPractice = (mode = DailyMode.COVER) => pool.pickPractice(mode);

    /** 500 games that qualify for every mode and outrank the fixture, filling positions 1-500. */
    const addDeepPool = async () => {
        const ids = Array.from({ length: 500 }, (_, n) => DEEP_POOL_ID + n);
        const rows = ids.map((gameId) => [
            gameId,
            `deep ${gameId}`,
            `deep-${gameId}`,
            0,
            2,
            "2000-01-01",
        ]);
        await query(
            "INSERT INTO game (id, name, slug, category, aggregatedRatingCount, firstReleaseDate) VALUES ?",
            [rows],
        );
        await query("INSERT INTO game_cover (id, gameId, url) VALUES ?", [
            ids.map((gameId) => [gameId, gameId, "fixture"]),
        ]);
        await query("INSERT INTO game_genre (id) VALUES ?", [
            ids.map((gameId) => [gameId]),
        ]);
        await query("INSERT INTO game_platform (id, name) VALUES ?", [
            ids.map((gameId) => [gameId, `platform ${gameId}`]),
        ]);
        await query("INSERT INTO game_company (id, name, slug) VALUES ?", [
            ids.map((gameId) => [
                gameId,
                `company ${gameId}`,
                `company-${gameId}`,
            ]),
        ]);
        await query(
            "INSERT INTO game_involved_company (id, companyId, developer, publisher, porting, supporting) VALUES ?",
            [ids.map((gameId) => [gameId, gameId, 1, 0, 0, 0])],
        );
        await query("INSERT INTO game_genres_game_genre VALUES ?", [
            ids.map((gameId) => [gameId, gameId]),
        ]);
        await query("INSERT INTO game_platform_games_game VALUES ?", [
            ids.map((gameId) => [gameId, gameId]),
        ]);
        await query(
            "INSERT INTO game_involved_companies_game_involved_company VALUES ?",
            [ids.map((gameId) => [gameId, gameId])],
        );
        return new Set(ids);
    };

    const addSpecsAttributes = async () => {
        await query("INSERT INTO game_genre (id) VALUES (?)", [id]);
        await query(
            "INSERT INTO game_platform (id, name) VALUES (?, 'fixture')",
            [id],
        );
        await query(
            "INSERT INTO game_company (id, name, slug) VALUES (?, 'fixture', ?)",
            [id, `fixture-${id}`],
        );
        await query(
            "INSERT INTO game_involved_company (id, companyId, developer, publisher, porting, supporting) VALUES (?, ?, 1, 0, 0, 0)",
            [id, id],
        );
        await query("INSERT INTO game_genres_game_genre VALUES (?, ?)", [
            id,
            id,
        ]);
        await query("INSERT INTO game_platform_games_game VALUES (?, ?)", [
            id,
            id,
        ]);
        await query(
            "INSERT INTO game_involved_companies_game_involved_company VALUES (?, ?)",
            [id, id],
        );
    };

    /** Gives the fixture every Specs attribute, including the past release. */
    const addSpecsGame = async () => {
        await addSpecsAttributes();
        await query(
            "UPDATE game SET firstReleaseDate = '2000-01-01' WHERE id = ?",
            [id],
        );
    };

    beforeAll(async () => {
        db = await createNotificationTestDataSource();
    }, 120000);
    afterAll(async () => {
        if (db?.isInitialized) await db.destroy();
    });
    beforeEach(async () => {
        tx = db.createQueryRunner();
        await tx.connect();
        await tx.startTransaction();
        pool = new DailyPoolService({ query: query } as DataSource);
        await query(
            "INSERT INTO game (id, name, slug, category, aggregatedRatingCount) VALUES (?, ?, ?, 0, 1)",
            [id, "Pool fixture", `pool-fixture-${id}`],
        );
        await query(
            "INSERT INTO game_cover (id, gameId, url) VALUES (?, ?, 'fixture')",
            [id, id],
        );
    });
    afterEach(async () => {
        await tx.rollbackTransaction();
        await tx.release();
    });

    it.each([null, 0, 1, 2])(
        "applies critic floor for %s regardless of popularity",
        async (count) => {
            await query(
                "INSERT INTO statistics_target (id, sourceType) VALUES (?, 'GAME')",
                [id],
            );
            await query(
                "UPDATE game SET aggregatedRatingCount = ?, statisticsTargetId = ? WHERE id = ?",
                [count, id, id],
            );
            await query(
                "INSERT INTO ranking_score (rankingKey, targetId, score, definitionVersion) VALUES ('game:popular:all', ?, 999, 'test')",
                [id],
            );
            expect(await pick()).toEqual(
                count ? { gameId: id, meta: {} } : null,
            );
        },
    );
    it("does not require a ranking row", async () => {
        expect(await pick()).toEqual({ gameId: id, meta: {} });
        await query("UPDATE game_cover SET url = NULL WHERE id = ?", [id]);
        expect(await pick()).toBeNull();
    });
    it("excludes unsuitable modes and preserves artwork and keyword metadata", async () => {
        expect(await pick(DailyMode.ARTWORK)).toBeNull();
        expect(await pick(DailyMode.KEYWORDS)).toBeNull();
        expect(await pick(DailyMode.SPECS)).toBeNull();
        await query(
            "INSERT INTO game_artwork (id, gameId, url) VALUES (?, ?, 'fixture')",
            [id, id],
        );
        for (let n = 0; n < 8; n++) {
            await query("INSERT INTO game_keyword (id, name) VALUES (?, ?)", [
                id + n,
                `keyword ${n}`,
            ]);
            await query(
                "INSERT INTO game_keywords_game_keyword (gameId, gameKeywordId) VALUES (?, ?)",
                [id, id + n],
            );
        }
        expect(await pick(DailyMode.ARTWORK)).toEqual({
            gameId: id,
            meta: { artworkId: id },
        });
        await query("UPDATE game_artwork SET url = NULL WHERE id = ?", [id]);
        expect(await pick(DailyMode.ARTWORK)).toBeNull();
        const result = await pick(DailyMode.KEYWORDS);
        expect(result?.gameId).toBe(id);
        expect(result?.meta.keywordIds?.sort()).toEqual(
            Array.from({ length: 8 }, (_, n) => id + n).sort(),
        );
        await query("UPDATE game_keyword SET name = NULL WHERE id = ?", [id]);
        expect(await pick(DailyMode.KEYWORDS)).toBeNull();
    });
    it("requires all specs attributes and a past release", async () => {
        await addSpecsAttributes();
        expect(await pick(DailyMode.SPECS)).toBeNull();
        await query(
            "UPDATE game SET firstReleaseDate = '2000-01-01' WHERE id = ?",
            [id],
        );
        expect(await pick(DailyMode.SPECS)).toEqual({ gameId: id, meta: {} });
        await query("DELETE FROM game_genres_game_genre WHERE gameId = ?", [
            id,
        ]);
        expect(await pick(DailyMode.SPECS)).toBeNull();
        await query("INSERT INTO game_genres_game_genre VALUES (?, ?)", [
            id,
            id,
        ]);
        await query("DELETE FROM game_platform_games_game WHERE gameId = ?", [
            id,
        ]);
        expect(await pick(DailyMode.SPECS)).toBeNull();
        await query("INSERT INTO game_platform_games_game VALUES (?, ?)", [
            id,
            id,
        ]);
        await query(
            "UPDATE game_involved_company SET developer = 0 WHERE id = ?",
            [id],
        );
        expect(await pick(DailyMode.SPECS)).toBeNull();
    });
    it("excludes non-main and mature games", async () => {
        await query("UPDATE game SET category = 1 WHERE id = ?", [id]);
        expect(await pick()).toBeNull();
        await query("UPDATE game SET category = 0 WHERE id = ?", [id]);
        await query(
            "INSERT IGNORE INTO game_theme (id, name) VALUES (42, 'Mature')",
        );
        await query(
            "INSERT INTO game_themes_game_theme (gameId, gameThemeId) VALUES (?, 42)",
            [id],
        );
        expect(await pick()).toBeNull();
    });
    it.each([
        ["2098-01-01", DailyMode.COVER, true],
        ["2098-01-02", DailyMode.COVER, false],
        ["2099-01-02", DailyMode.COVER, false],
        ["2099-01-02", DailyMode.ARTWORK, true],
    ])("handles reservation %s in %s", async (reserved, mode, eligible) => {
        await query(
            "INSERT INTO daily_puzzle (mode, number, date, gameId, meta) VALUES (?, 987654321, ?, ?, '{}')",
            [mode, reserved, id],
        );
        expect(await pick()).toEqual(
            eligible ? { gameId: id, meta: {} } : null,
        );
    });
    it("filters unsuitable high-count games before the cap", async () => {
        const values = Array.from({ length: 1001 }, (_, n) => [
            id + n + 1,
            `cap ${n}`,
            `cap-${id + n + 1}`,
            0,
            100,
        ]);
        await query(
            "INSERT INTO game (id, name, slug, category, aggregatedRatingCount) VALUES ?",
            [values],
        );
        expect(await pick()).toEqual({ gameId: id, meta: {} });
    });
    it("keeps the 500 most reviewed games out of the weekly challenge", async () => {
        const topIds = await addDeepPool();
        for (let draw = 0; draw < 10; draw++) {
            const picked = await pickWeekly();
            expect(picked).not.toBeNull();
            expect(picked && topIds.has(picked.gameId)).toBe(false);
        }
    });
    it("excludes a recent daily Specs answer from the weekly challenge", async () => {
        await addDeepPool();
        await addSpecsGame();
        await query(
            "INSERT INTO daily_puzzle (kind, mode, number, date, gameId, meta) VALUES ('daily', 'specs', 777001, ?, ?, '{}')",
            [addDays(date, -100), id],
        );
        expect(await pickWeekly(DailyMode.SPECS)).toBeNull();
        // Past the 365-day window it is eligible again, so the exclusion above was the reservation.
        await query("UPDATE daily_puzzle SET date = ? WHERE gameId = ?", [
            addDays(date, -400),
            id,
        ]);
        expect(await pickWeekly(DailyMode.SPECS)).toEqual({
            gameId: id,
            meta: {},
        });
    });
    it("excludes a queued weekly answer from daily Specs", async () => {
        await addSpecsGame();
        await query(
            "INSERT INTO daily_puzzle (kind, mode, number, date, gameId, meta) VALUES ('weekly', 'specs', 777002, ?, ?, '{}')",
            [addDays(date, 7), id],
        );
        expect(await pick(DailyMode.SPECS)).toBeNull();
        await query("DELETE FROM daily_puzzle WHERE number = 777002");
        expect(await pick(DailyMode.SPECS)).toEqual({ gameId: id, meta: {} });
    });

    const insertDailyAnswer = (
        mode: DailyMode,
        answerDate: string,
        number: number,
    ) =>
        query(
            "INSERT INTO daily_puzzle (kind, mode, number, date, gameId, meta) VALUES ('daily', ?, ?, ?, ?, '{}')",
            [mode, number, answerDate, id],
        );
    const insertWeeklyAnswer = (answerDate: string, number: number) =>
        query(
            "INSERT INTO daily_puzzle (kind, mode, number, date, gameId, meta) VALUES ('weekly', 'specs', ?, ?, ?, '{}')",
            [number, answerDate, id],
        );

    it("excludes today's and future daily answers in every mode from practice", async () => {
        const today = dailyToday();
        expect(await pickPractice()).toEqual({ gameId: id, meta: {} });
        let number = 778_000;
        for (const mode of Object.values(DailyMode))
            await insertDailyAnswer(mode, today, ++number);
        expect(await pickPractice()).toBeNull();
        await query("DELETE FROM daily_puzzle WHERE number >= 778000");
        await insertDailyAnswer(DailyMode.ARTWORK, addDays(today, 1), 778_100);
        expect(await pickPractice()).toBeNull();
    });

    it("excludes the current and next weekly answer from practice", async () => {
        const monday = mondayOf(dailyToday());
        await insertWeeklyAnswer(addDays(monday, 7), 778_200);
        expect(await pickPractice()).toBeNull();
        await query("DELETE FROM daily_puzzle WHERE number = 778200");
        await insertWeeklyAnswer(monday, 778_201);
        expect(await pickPractice()).toBeNull();
    });

    it("allows past daily answers in practice and keeps the mode filters", async () => {
        await addSpecsGame();
        await insertDailyAnswer(
            DailyMode.SPECS,
            addDays(dailyToday(), -100),
            778_300,
        );
        // Still inside the daily repeat window, but practice has none.
        expect(await pool.pick(DailyMode.SPECS, dailyToday())).toBeNull();
        expect(await pickPractice(DailyMode.SPECS)).toEqual({
            gameId: id,
            meta: {},
        });
        expect(await pickPractice(DailyMode.ARTWORK)).toBeNull();
        expect(await pickPractice(DailyMode.KEYWORDS)).toBeNull();
    });
});
