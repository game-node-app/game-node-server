import { MigrationInterface, QueryRunner } from "typeorm";

const sources = ["game", "review", "activity", "post", "review_comment", "activity_comment", "post_comment"];
const legacyTables = ["user_like", "user_view", "game_statistics", "review_statistics", "activity_statistics", "comment_statistics", "post_statistics"];

export class RetireLegacyStatisticsStorage1792960197570 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        if (!(await runner.hasTable("statistics_maintenance")))
            throw new Error("Statistics conversion and rebuild are required before removing legacy storage");
        const [maintenance] = await runner.query(
            "SELECT state, operation, backupReference, report FROM statistics_maintenance WHERE id = 'main'",
        );
        let report = maintenance?.report;
        if (typeof report === "string") report = JSON.parse(report);
        if (
            maintenance?.state !== "complete" ||
            maintenance.operation !== "rebuild" ||
            !maintenance.backupReference ||
            report?.conversion?.complete !== true ||
            report?.rebuild?.complete !== true
        ) throw new Error("Complete the coordinated statistics conversion and rebuild before removing legacy storage");

        for (const source of sources) {
            if (!(await runner.hasTable(source)) || !(await runner.hasColumn(source, "statisticsTargetId")))
                throw new Error(`Missing statistics target identity on ${source}`);
            const [missing] = await runner.query(`SELECT COUNT(*) AS count FROM \`${source}\` WHERE statisticsTargetId IS NULL`);
            if (Number(missing.count)) throw new Error(`Statistics conversion left sources without targets in ${source}`);
            const table = await runner.getTable(source);
            if (!table?.foreignKeys.some((entry) => entry.columnNames.join() === "statisticsTargetId" && entry.referencedTableName === "statistics_target"))
                throw new Error(`Missing statistics target foreign key on ${source}`);
            await runner.query(`ALTER TABLE \`${source}\` MODIFY statisticsTargetId BIGINT UNSIGNED NOT NULL`);
        }

        for (const table of legacyTables)
            if (await runner.hasTable(table)) await runner.dropTable(table);
    }

    async down(): Promise<void> {
        throw new Error("Legacy statistics removal requires the coordinated database backup and previous code");
    }
}
