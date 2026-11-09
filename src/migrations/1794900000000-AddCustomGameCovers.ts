import { MigrationInterface, QueryRunner } from "typeorm";

/** Design 1: cover option catalog, per-user choice, edition link and display mode. */
export class AddCustomGameCovers1794900000000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        await runner.query(`CREATE TABLE \`game_cover_option\` (
            \`id\` bigint NOT NULL AUTO_INCREMENT,
            \`gameId\` bigint NOT NULL,
            \`kind\` varchar(16) NOT NULL,
            \`origin\` varchar(16) NOT NULL,
            \`igdbId\` bigint NOT NULL,
            \`imageId\` text,
            \`url\` text,
            \`width\` int DEFAULT NULL,
            \`height\` int DEFAULT NULL,
            \`alphaChannel\` tinyint DEFAULT NULL,
            \`animated\` tinyint DEFAULT NULL,
            \`checksum\` text,
            \`label\` varchar(255) DEFAULT NULL,
            PRIMARY KEY (\`id\`),
            UNIQUE KEY \`UQ_game_cover_option_origin_igdb\` (\`origin\`,\`igdbId\`),
            KEY \`IDX_game_cover_option_game\` (\`gameId\`),
            CONSTRAINT \`FK_game_cover_option_game\` FOREIGN KEY (\`gameId\`) REFERENCES \`game\` (\`id\`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
        await runner.query(`CREATE TABLE \`user_game_cover\` (
            \`userId\` varchar(36) NOT NULL,
            \`gameId\` bigint NOT NULL,
            \`coverOptionId\` bigint NOT NULL,
            PRIMARY KEY (\`userId\`,\`gameId\`),
            KEY \`IDX_user_game_cover_game\` (\`gameId\`),
            KEY \`IDX_user_game_cover_option\` (\`coverOptionId\`),
            CONSTRAINT \`FK_user_game_cover_profile\` FOREIGN KEY (\`userId\`) REFERENCES \`profile\` (\`userId\`) ON DELETE CASCADE,
            CONSTRAINT \`FK_user_game_cover_game\` FOREIGN KEY (\`gameId\`) REFERENCES \`game\` (\`id\`) ON DELETE CASCADE,
            CONSTRAINT \`FK_user_game_cover_option\` FOREIGN KEY (\`coverOptionId\`) REFERENCES \`game_cover_option\` (\`id\`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
        await runner.query(
            "ALTER TABLE `game` ADD `versionParentId` bigint NULL, ADD `versionTitle` varchar(255) NULL, ADD KEY `IDX_game_version_parent` (`versionParentId`)",
        );
        // Checks off avoids a table copy; every value is still NULL (design Risks).
        await runner.query("SET FOREIGN_KEY_CHECKS = 0");
        await runner.query(
            "ALTER TABLE `game` ADD CONSTRAINT `FK_game_version_parent` FOREIGN KEY (`versionParentId`) REFERENCES `game` (`id`) ON DELETE SET NULL",
        );
        await runner.query("SET FOREIGN_KEY_CHECKS = 1");
        await runner.query(
            "ALTER TABLE `profile` ADD `customCoverMode` varchar(16) NOT NULL DEFAULT 'any'",
        );
    }

    async down(runner: QueryRunner): Promise<void> {
        await runner.query("DROP TABLE `user_game_cover`");
        await runner.query("DROP TABLE `game_cover_option`");
        await runner.query(
            "ALTER TABLE `game` DROP FOREIGN KEY `FK_game_version_parent`",
        );
        await runner.query(
            "ALTER TABLE `game` DROP KEY `IDX_game_version_parent`, DROP COLUMN `versionParentId`, DROP COLUMN `versionTitle`",
        );
        await runner.query(
            "ALTER TABLE `profile` DROP COLUMN `customCoverMode`",
        );
    }
}
