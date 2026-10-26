import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRecapStatisticsCoverage1792960197569
    implements MigrationInterface
{
    async up(runner: QueryRunner): Promise<void> {
        if (!(await runner.hasTable("year_recap"))) return;
        if (!(await runner.hasColumn("year_recap", "likesHistoryComplete")))
            await runner.query(
                "ALTER TABLE year_recap ADD likesHistoryComplete TINYINT(1) NOT NULL DEFAULT 0",
            );
        if (!(await runner.hasColumn("year_recap", "likesCompleteSince")))
            await runner.query(
                "ALTER TABLE year_recap ADD likesCompleteSince DATETIME(6) NULL",
            );
    }

    async down(runner: QueryRunner): Promise<void> {
        if (!(await runner.hasTable("year_recap"))) return;
        if (await runner.hasColumn("year_recap", "likesCompleteSince"))
            await runner.query(
                "ALTER TABLE year_recap DROP COLUMN likesCompleteSince",
            );
        if (await runner.hasColumn("year_recap", "likesHistoryComplete"))
            await runner.query(
                "ALTER TABLE year_recap DROP COLUMN likesHistoryComplete",
            );
    }
}
