import { MigrationInterface, QueryRunner } from "typeorm";

export class AddExternalGameOrigin1794100000000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        await runner.query(
            "ALTER TABLE `game_external_game` ADD `origin` varchar(16) NOT NULL DEFAULT 'igdb'",
        );
    }

    async down(runner: QueryRunner): Promise<void> {
        // GameNode-owned rows have no meaning without the column.
        await runner.query(
            "DELETE FROM `game_external_game` WHERE `origin` <> 'igdb'",
        );
        await runner.query(
            "ALTER TABLE `game_external_game` DROP COLUMN `origin`",
        );
    }
}
