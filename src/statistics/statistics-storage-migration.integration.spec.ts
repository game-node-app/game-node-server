import "reflect-metadata";
import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { PrepareStatisticsStorage1792960197568 } from "../migrations/1792960197568-PrepareStatisticsStorage";
import { IndexGameStatisticsRankings1792960197571 } from "../migrations/1792960197571-IndexGameStatisticsRankings";

const sourceTables = ["game", "review", "activity", "post", "review_comment", "activity_comment", "post_comment"];
const statisticsTables = ["ranking_score", "metric_hour", "metric_total", "statistics_event", "engagement_state", "statistics_maintenance", "statistics_target"];

describe("statistics storage migration", () => {
    let dataSource: DataSource;

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();
    });

    afterAll(async () => {
        if (dataSource?.isInitialized) await dataSource.destroy();
    });

    it("installs fresh and upgrades existing sources without touching notification state", async () => {
        const runner = dataSource.createQueryRunner();
        await runner.connect();
        try {
            const notificationTables = ["notification_event", "notification_inbox", "notification_cutover_state"];
            const before = new Map<string, string>();
            for (const table of notificationTables) {
                if (await runner.hasTable(table)) {
                    const rows = await runner.query(`SELECT * FROM \`${table}\` ORDER BY 1`);
                    before.set(table, JSON.stringify(rows));
                }
            }

            for (const source of sourceTables) {
                const table = await runner.getTable(source);
                for (const foreignKey of table?.foreignKeys.filter((key) => key.columnNames.includes("statisticsTargetId")) ?? [])
                    await runner.query(`ALTER TABLE \`${source}\` DROP FOREIGN KEY \`${foreignKey.name}\``);
                const refreshed = await runner.getTable(source);
                for (const index of refreshed?.indices.filter((entry) => entry.columnNames.includes("statisticsTargetId")) ?? [])
                    await runner.query(`ALTER TABLE \`${source}\` DROP INDEX \`${index.name}\``);
                if (await runner.hasColumn(source, "statisticsTargetId"))
                    await runner.query(`ALTER TABLE \`${source}\` DROP COLUMN statisticsTargetId`);
            }
            for (const table of statisticsTables)
                if (await runner.hasTable(table)) await runner.dropTable(table);

            const migration = new PrepareStatisticsStorage1792960197568();
            await migration.up(runner);
            await migration.up(runner);

            const rankingIndex = new IndexGameStatisticsRankings1792960197571();
            const gamesBefore = await runner.query("SELECT COUNT(*) AS total FROM game");
            await rankingIndex.up(runner);
            await rankingIndex.down(runner);
            await rankingIndex.up(runner);
            await rankingIndex.up(runner);
            expect(await runner.query("SELECT COUNT(*) AS total FROM game")).toEqual(gamesBefore);
            expect((await runner.getTable("game"))?.indices.find((index) => index.name === "IDX_game_statistics_ranking")?.columnNames)
                .toEqual(["id", "statisticsTargetId", "status", "category"]);

            for (const source of sourceTables) {
                const table = await runner.getTable(source);
                expect(await runner.hasColumn(source, "statisticsTargetId")).toBe(true);
                expect(table?.indices.some((index) => index.isUnique && index.columnNames.join() === "statisticsTargetId")).toBe(true);
                expect(table?.foreignKeys.some((key) => key.columnNames.join() === "statisticsTargetId" && key.referencedTableName === "statistics_target")).toBe(true);
            }
            expect(await runner.hasTable("statistics_event")).toBe(true);
            expect(await runner.hasTable("metric_total")).toBe(true);
            expect(await runner.hasTable("metric_hour")).toBe(true);
            expect(await runner.hasTable("ranking_score")).toBe(true);
            expect(await runner.hasTable("statistics_maintenance")).toBe(false);

            for (const [table, expected] of before) {
                const rows = await runner.query(`SELECT * FROM \`${table}\` ORDER BY 1`);
                expect(JSON.stringify(rows)).toBe(expected);
            }
        } finally {
            await runner.release();
        }
    });
});
