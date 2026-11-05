import { DataSource, QueryRunner } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { DailyMode } from "./daily.constants";
import { DailyPoolService } from "./daily-pool.service";

const id = 987654321;
const date = "2099-01-01";

describe("DailyPoolService on MySQL", () => {
    let db: DataSource;
    let tx: QueryRunner;
    let pool: DailyPoolService;
    const query = (sql: string, params: unknown[] = []) =>
        tx.query(sql, params);
    const pick = (mode = DailyMode.COVER) => pool.pick(mode, date);

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
});
