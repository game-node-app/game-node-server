import "reflect-metadata";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DataSource } from "typeorm";
import { createConnection, Connection } from "mysql2/promise";
import { testEnvironment } from "../../test/igdb/helpers/test-environment";
import { AddGameSearchName1795800000000 } from "./1795800000000-AddGameSearchName";

const DATABASE = "migration_chain_test";
// Test container credentials from test/igdb/docker-compose.yml.
const ADMIN = { user: "root", password: "igdb-test-root" };

/**
 * The deploy runs every committed migration, in order, on the production database. This is the
 * only test that does the same on an empty one, so a migration that only works on top of a
 * hand-built schema (or on a database with another default collation) fails here, not in a deploy.
 */
describe("migration chain on an empty database", () => {
    let source: DataSource;
    let admin: Connection;
    const files = readdirSync(__dirname).filter((name) =>
        /^\d+-.*\.ts$/.test(name),
    );

    beforeAll(async () => {
        const mysql = testEnvironment(process.env).mysql;
        admin = await createConnection({
            host: mysql.host,
            port: mysql.port,
            ...ADMIN,
        });
        await admin.query(`DROP DATABASE IF EXISTS \`${DATABASE}\``);
        // The collation the migrations assume, whatever the server default is: a profile.userId
        // with another collation makes every foreign key to it fail (ER_FK_INCOMPATIBLE_COLUMNS).
        await admin.query(
            `CREATE DATABASE \`${DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
        );
        source = await new DataSource({
            type: "mysql",
            host: mysql.host,
            port: mysql.port,
            username: ADMIN.user,
            password: ADMIN.password,
            database: DATABASE,
            timezone: "Z",
            synchronize: false,
            // Same default as `pnpm migration:run` (data-source.ts): one transaction for all.
            migrations: files.map((name) => resolve(__dirname, name)),
        }).initialize();
    });

    afterAll(async () => {
        if (source?.isInitialized) await source.destroy();
        if (admin) {
            await admin.query(`DROP DATABASE IF EXISTS \`${DATABASE}\``);
            await admin.end();
        }
    });

    it("applies every migration and leaves none pending", async () => {
        const applied = await source.runMigrations();

        expect(files.length).toBeGreaterThan(0);
        expect(applied).toHaveLength(files.length);
        expect(await source.showMigrations()).toBe(false);
    });

    it("creates the daily ranking schema with the descending order index", async () => {
        const columns = await source.query(
            `SELECT COLUMN_NAME AS name, COLLATION AS direction
            FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'daily_ranking_entry'
                AND INDEX_NAME = 'IDX_daily_ranking_entry_order'
            ORDER BY SEQ_IN_INDEX`,
        );

        expect(
            columns.map((row: any) => `${row.name}:${row.direction}`),
        ).toEqual([
            "period:A",
            "periodStart:A",
            "mode:A",
            "points:D",
            "winAttempts:A",
            "lastFinishedAt:A",
            "userId:A",
        ]);
    });

    it("reverts and re-applies every migration newer than the daily ranking schema", async () => {
        // Later migrations sit above this one, so revert until its table is gone instead of
        // assuming this is the newest migration in the chain.
        for (let undone = 0; undone < files.length; undone++) {
            if (
                (await source.query("SHOW TABLES LIKE 'daily_ranking_entry'"))
                    .length === 0
            )
                break;
            await source.undoLastMigration();
        }
        expect(await source.showMigrations()).toBe(true);
        expect(
            await source.query("SHOW TABLES LIKE 'daily_ranking_entry'"),
        ).toHaveLength(0);

        await source.runMigrations();
        expect(await source.showMigrations()).toBe(false);
        expect(
            await source.query("SHOW TABLES LIKE 'daily_ranking_entry'"),
        ).toHaveLength(1);
    });

    it("recovers the game search migration when only one column exists", async () => {
        const runner = source.createQueryRunner();
        const migration = new AddGameSearchName1795800000000();
        try {
            await runner.query(
                "ALTER TABLE `game_alternative_name` DROP COLUMN `searchName`",
            );
            await migration.up(runner);
            expect(await runner.hasColumn("game", "searchName")).toBe(true);
            expect(
                await runner.hasColumn("game_alternative_name", "searchName"),
            ).toBe(true);
            expect(
                await runner.query(
                    "SELECT `table` FROM `typeorm_metadata` WHERE `schema` = DATABASE() AND `type` = 'GENERATED_COLUMN' AND `name` = 'searchName' ORDER BY `table`",
                ),
            ).toEqual([{ table: "game" }, { table: "game_alternative_name" }]);
        } finally {
            await runner.release();
        }
    });
});
