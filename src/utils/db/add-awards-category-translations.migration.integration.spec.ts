import "reflect-metadata";
import { resolve } from "node:path";
import { DataSource } from "typeorm";
import { createConnection, Connection } from "mysql2/promise";
import { testEnvironment } from "../../../test/igdb/helpers/test-environment";
import { createBaselineTables } from "../../../test/baseline-schema";
import { AddAwardsCategoryTranslations1795500000000 } from "../../migrations/1795500000000-AddAwardsCategoryTranslations";
import { AwardsCategoryTranslation } from "../../awards/entity/awards-category-translation.entity";

const DATABASE = "awards_translation_migration_test";
// Test container credentials from test/igdb/docker-compose.yml; the fixture user only owns igdb_sync_test.
const ADMIN = { user: "root", password: "igdb-test-root" };
const BASELINE_TABLES = ["awards_event", "awards_category"];

describe("AddAwardsCategoryTranslations migration", () => {
    let source: DataSource;
    let admin: Connection;

    beforeAll(async () => {
        const mysql = testEnvironment(process.env).mysql;
        admin = await createConnection({
            host: mysql.host,
            port: mysql.port,
            ...ADMIN,
        });
        await admin.query(`DROP DATABASE IF EXISTS \`${DATABASE}\``);
        await admin.query(`CREATE DATABASE \`${DATABASE}\``);
        source = await new DataSource({
            type: "mysql",
            host: mysql.host,
            port: mysql.port,
            username: ADMIN.user,
            password: ADMIN.password,
            database: DATABASE,
            entities: [resolve(__dirname, "../../**/*.entity.ts")],
            synchronize: false,
        }).initialize();
        await createBaselineTables(source, BASELINE_TABLES);
        await source.query(
            `INSERT INTO \`awards_event\` (\`id\`, \`year\`, \`votingStartDate\`, \`votingEndDate\`, \`resultsDate\`)
            VALUES (1, 2026, '2026-12-01 00:00:00', '2026-12-20 00:00:00', '2026-12-27 00:00:00')`,
        );
        await source.query(
            `INSERT INTO \`awards_category\` (\`id\`, \`eventId\`, \`name\`, \`order\`, \`description\`)
            VALUES (1, 1, 'Game of the Year', 1, 'GOTY'), (2, 1, 'Narrativa', 2, 'Story')`,
        );
    });

    afterAll(async () => {
        if (source?.isInitialized) await source.destroy();
        if (admin) {
            await admin.query(`DROP DATABASE IF EXISTS \`${DATABASE}\``);
            await admin.end();
        }
    });

    it("runs up, enforces one translation per locale and cascades on category delete", async () => {
        const migration = new AddAwardsCategoryTranslations1795500000000();
        const runner = source.createQueryRunner();
        try {
            await migration.up(runner);

            expect(await runner.hasTable("awards_category_translation")).toBe(
                true,
            );
            const metadata = source.getMetadata(AwardsCategoryTranslation);
            const table = await runner.getTable(metadata.tableName);
            expect(table?.columns.map((column) => column.name).sort()).toEqual(
                metadata.columns.map((column) => column.databaseName).sort(),
            );

            const unique = await source.query(
                `SELECT COLUMN_NAME FROM information_schema.STATISTICS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'awards_category_translation'
                  AND INDEX_NAME = 'UQ_awards_category_translation_category_locale'
                ORDER BY SEQ_IN_INDEX`,
            );
            expect(unique.map((row: any) => row.COLUMN_NAME)).toEqual([
                "categoryId",
                "locale",
            ]);

            await source.query(
                `INSERT INTO \`awards_category_translation\` (\`categoryId\`, \`locale\`, \`name\`, \`description\`)
                VALUES (1, 'en', 'Game of the Year', 'GOTY'), (1, 'pt-BR', 'Jogo do Ano', 'Jogo do ano')`,
            );
            await expect(
                source.query(
                    `INSERT INTO \`awards_category_translation\` (\`categoryId\`, \`locale\`, \`name\`, \`description\`)
                    VALUES (1, 'en', 'Duplicate', 'Duplicate')`,
                ),
            ).rejects.toThrow(/Duplicate entry/);

            await source.query(
                `INSERT INTO \`awards_category_translation\` (\`categoryId\`, \`locale\`, \`name\`, \`description\`)
                VALUES (2, 'en', 'Narrative', 'Story')`,
            );
            await source.query("DELETE FROM `awards_category` WHERE `id` = 2");
            const remaining = await source.query(
                "SELECT `categoryId`, `locale` FROM `awards_category_translation` ORDER BY `locale`",
            );
            expect(
                remaining.map((row: any) => ({
                    categoryId: Number(row.categoryId),
                    locale: row.locale,
                })),
            ).toEqual([
                { categoryId: 1, locale: "en" },
                { categoryId: 1, locale: "pt-BR" },
            ]);
        } finally {
            await runner.release();
        }
    });

    it("runs down and drops the table", async () => {
        const migration = new AddAwardsCategoryTranslations1795500000000();
        const runner = source.createQueryRunner();
        try {
            await migration.down(runner);
            expect(await runner.hasTable("awards_category_translation")).toBe(
                false,
            );
        } finally {
            await runner.release();
        }
    });
});
