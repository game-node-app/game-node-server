import "reflect-metadata";
import { resolve } from "node:path";
import { DataSource } from "typeorm";
import { createConnection, Connection } from "mysql2/promise";
import { testEnvironment } from "../../../test/igdb/helpers/test-environment";
import { createBaselineTables } from "../../../test/baseline-schema";
import { Add2026RecapAndAwardsEvents1795300000000 } from "../../migrations/1795300000000-Add2026RecapAndAwardsEvents";
import { AwardsEvent } from "../../awards/entity/awards-event.entity";
import { AwardsCategory } from "../../awards/entity/awards-category.entity";
import { AwardsCategoryResult } from "../../awards/entity/awards-category-result.entity";
import { AwardsCategoryResultWinner } from "../../awards/entity/awards-category-winner.entity";
import { AwardsNomination } from "../../awards/entity/awards-nomination.entity";
import { YearRecap } from "../../recap/entity/year-recap.entity";
import { YearRecapPlayedGame } from "../../recap/entity/year-recap-played-game.entity";
import { YearRecapEdition } from "../../recap/entity/year-recap-edition.entity";
import { YearGoal } from "../../recap/entity/year-goal.entity";
import { NotificationCampaign } from "../../notifications/entity/notification-campaign.entity";

const DATABASE = "awards_migration_test";
// Test container credentials from test/igdb/docker-compose.yml; the fixture user only owns igdb_sync_test.
const ADMIN = { user: "root", password: "igdb-test-root" };
const BASELINE_TABLES = [
    "profile",
    "game",
    "awards_event",
    "awards_category",
    "awards_category_suggestion",
    "awards_category_result",
    "awards_category_result_winner",
    "year_recap",
    "year_recap_played_game",
];
const MIGRATED_ENTITIES = [
    AwardsEvent,
    AwardsCategory,
    AwardsCategoryResult,
    AwardsCategoryResultWinner,
    AwardsNomination,
    YearRecap,
    YearRecapPlayedGame,
    YearRecapEdition,
    YearGoal,
    NotificationCampaign,
];

describe("Add2026RecapAndAwardsEvents migration", () => {
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
        // Keep the FK indexed while the unique guard is removed to simulate the legacy duplicates.
        await source.query(
            "ALTER TABLE `awards_category_result` ADD KEY `IDX_awards_result_category` (`categoryId`)",
        );
        await source.query(
            "ALTER TABLE `awards_category_result` DROP KEY `REL_e84e25de0cf2eca42989af8187`",
        );
        await source.query(
            "INSERT INTO `game` (`id`, `name`, `slug`) VALUES (1, 'Game A', 'game-a'), (2, 'Game B', 'game-b')",
        );
        await source.query(
            `INSERT INTO \`awards_event\` (\`id\`, \`year\`, \`votingStartDate\`, \`votingEndDate\`, \`resultsDate\`)
            VALUES (1, 2026, '2026-12-01 00:00:00', '2026-12-20 00:00:00', '2026-12-27 00:00:00')`,
        );
        await source.query(
            `INSERT INTO \`awards_category\` (\`id\`, \`eventId\`, \`name\`, \`order\`, \`description\`)
            VALUES (1, 1, 'Game of the Year', 1, 'GOTY')`,
        );
        // Two results for one category, as stored by a processor run four times before the unique guard.
        await source.query(
            `INSERT INTO \`awards_category_result\` (\`id\`, \`totalVotesCount\`, \`totalUniqueGamesSubmitted\`, \`totalUsersParticipating\`, \`categoryId\`)
            VALUES (1, 10, 2, 10, 1), (2, 10, 2, 10, 1)`,
        );
        await source.query(
            `INSERT INTO \`awards_category_result_winner\` (\`resultId\`, \`gameId\`, \`position\`, \`totalVotes\`, \`votesPercentage\`)
            VALUES (1, 1, 1, 10, 1), (2, 2, 1, 10, 1)`,
        );
    });

    afterAll(async () => {
        if (source?.isInitialized) await source.destroy();
        if (admin) {
            await admin.query(`DROP DATABASE IF EXISTS \`${DATABASE}\``);
            await admin.end();
        }
    });

    it("runs up, keeps the lowest result per category and matches the entities", async () => {
        const migration = new Add2026RecapAndAwardsEvents1795300000000();
        const runner = source.createQueryRunner();
        try {
            await migration.up(runner);

            const results = await source.query(
                "SELECT `id` FROM `awards_category_result` WHERE `categoryId` = 1",
            );
            expect(results.map((row: any) => row.id)).toEqual([1]);
            const winners = await source.query(
                "SELECT `resultId`, `gameId` FROM `awards_category_result_winner`",
            );
            expect(
                winners.map((row: any) => ({
                    resultId: Number(row.resultId),
                    gameId: Number(row.gameId),
                })),
            ).toEqual([{ resultId: 1, gameId: 1 }]);

            const [unique] = await source.query(
                `SELECT INDEX_NAME FROM information_schema.STATISTICS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'awards_category_result'
                  AND COLUMN_NAME = 'categoryId'
                  AND NON_UNIQUE = 0`,
            );
            expect(unique.INDEX_NAME).toBe(
                "UQ_awards_category_result_category",
            );

            for (const table of [
                "awards_nomination",
                "year_recap_edition",
                "year_goal",
                "notification_campaign",
            ]) {
                expect(await runner.hasTable(table)).toBe(true);
            }

            for (const entity of MIGRATED_ENTITIES) {
                const metadata = source.getMetadata(entity);
                const table = await runner.getTable(metadata.tableName);
                expect(
                    table?.columns.map((column) => column.name).sort(),
                ).toEqual(
                    metadata.columns
                        .map((column) => column.databaseName)
                        .sort(),
                );
            }
        } finally {
            await runner.release();
        }
    });

    it("runs down and removes the new schema without touching the kept result", async () => {
        const migration = new Add2026RecapAndAwardsEvents1795300000000();
        const runner = source.createQueryRunner();
        try {
            await migration.down(runner);

            for (const table of [
                "awards_nomination",
                "year_recap_edition",
                "year_goal",
                "notification_campaign",
            ]) {
                expect(await runner.hasTable(table)).toBe(false);
            }
            const event = await runner.getTable("awards_event");
            expect(event?.columns.map((column) => column.name)).not.toEqual(
                expect.arrayContaining([
                    "nominationStartDate",
                    "nominationEndDate",
                    "eligibilityCutoffDate",
                ]),
            );
            const results = await source.query(
                "SELECT `id` FROM `awards_category_result` WHERE `categoryId` = 1",
            );
            expect(results.map((row: any) => row.id)).toEqual([1]);
            const [unique] = await source.query(
                `SELECT INDEX_NAME FROM information_schema.STATISTICS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'awards_category_result'
                  AND INDEX_NAME = 'UQ_awards_category_result_category'`,
            );
            expect(unique).toBeUndefined();
        } finally {
            await runner.release();
        }
    });
});
