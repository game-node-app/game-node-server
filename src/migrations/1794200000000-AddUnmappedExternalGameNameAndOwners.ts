import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUnmappedExternalGameNameAndOwners1794200000000
    implements MigrationInterface
{
    async up(runner: QueryRunner): Promise<void> {
        await runner.query(
            "ALTER TABLE `unmapped_external_game` ADD `name` varchar(255) NULL",
        );
        await runner.query(
            "CREATE TABLE `unmapped_external_game_owner` (`unmappedExternalGameId` int NOT NULL, `userId` varchar(36) NOT NULL, PRIMARY KEY (`unmappedExternalGameId`, `userId`), KEY `IDX_bdb71aca6d86b49e7fd181cca1` (`userId`), CONSTRAINT `FK_614912dc6d0dcb14dbb67429ded` FOREIGN KEY (`unmappedExternalGameId`) REFERENCES `unmapped_external_game` (`id`) ON DELETE CASCADE, CONSTRAINT `FK_bdb71aca6d86b49e7fd181cca10` FOREIGN KEY (`userId`) REFERENCES `profile` (`userId`) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci",
        );
    }

    async down(runner: QueryRunner): Promise<void> {
        await runner.query("DROP TABLE `unmapped_external_game_owner`");
        await runner.query(
            "ALTER TABLE `unmapped_external_game` DROP COLUMN `name`",
        );
    }
}
