import { MigrationInterface, QueryRunner } from "typeorm";

export class AddGameTotalRatingCount1794500000000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        // Filled by the next full IGDB catalog run; the Daily pool falls back to critic reviews until then.
        await runner.query(
            "ALTER TABLE `game` ADD `totalRatingCount` int DEFAULT NULL, ADD KEY `IDX_game_total_rating_count` (`totalRatingCount`)",
        );
    }

    async down(runner: QueryRunner): Promise<void> {
        await runner.query(
            "ALTER TABLE `game` DROP KEY `IDX_game_total_rating_count`, DROP COLUMN `totalRatingCount`",
        );
    }
}
