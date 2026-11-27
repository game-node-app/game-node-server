import { MigrationInterface, QueryRunner } from "typeorm";

/** Discovery keeps the library games it found unimported, so connection summaries stop calling the stores. */
export class AddPlayerConnectionLibraryCandidates1796300000000
    implements MigrationInterface
{
    async up(runner: QueryRunner): Promise<void> {
        await runner.query(
            "ALTER TABLE `player_connection_sync` ADD `libraryCandidates` json NULL",
        );
    }

    async down(runner: QueryRunner): Promise<void> {
        await runner.query(
            "ALTER TABLE `player_connection_sync` DROP COLUMN `libraryCandidates`",
        );
    }
}
