import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 2026 Recap and Awards schema (design decisions 2, 3, 8, 9b, 14).
 * The duplicate cleanup keeps the lowest result id per category; `down` cannot restore those rows.
 */
export class Add2026RecapAndAwardsEvents1795300000000
    implements MigrationInterface
{
    async up(runner: QueryRunner): Promise<void> {
        await runner.query(
            "ALTER TABLE `awards_event` ADD `nominationStartDate` datetime NULL, ADD `nominationEndDate` datetime NULL, ADD `eligibilityCutoffDate` datetime NULL",
        );
        await runner.query(
            "ALTER TABLE `awards_category` ADD `nomineeCount` smallint NOT NULL DEFAULT 6, ADD `nomineesFinalizedAt` datetime NULL",
        );
        await runner.query(
            "ALTER TABLE `awards_category_result` ADD `totalPlayedVotesCount` int NOT NULL DEFAULT 0",
        );

        await runner.query(
            `DELETE w FROM \`awards_category_result_winner\` w
            INNER JOIN \`awards_category_result\` r ON r.\`id\` = w.\`resultId\`
            INNER JOIN (
                SELECT \`categoryId\`, MIN(\`id\`) AS \`keepId\`
                FROM \`awards_category_result\`
                GROUP BY \`categoryId\`
            ) k ON k.\`categoryId\` = r.\`categoryId\`
            WHERE r.\`id\` <> k.\`keepId\``,
        );
        await runner.query(
            `DELETE r FROM \`awards_category_result\` r
            INNER JOIN (
                SELECT \`categoryId\`, MIN(\`id\`) AS \`keepId\`
                FROM \`awards_category_result\`
                GROUP BY \`categoryId\`
            ) k ON k.\`categoryId\` = r.\`categoryId\`
            WHERE r.\`id\` <> k.\`keepId\``,
        );
        // Some databases already carry the OneToOne unique key from the baseline schema.
        const [uniqueCategory] = await runner.query(
            `SELECT 1 FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'awards_category_result'
              AND NON_UNIQUE = 0
              AND SEQ_IN_INDEX = 1
              AND COLUMN_NAME = 'categoryId'
              AND INDEX_NAME IN (
                  SELECT INDEX_NAME FROM information_schema.STATISTICS
                  WHERE TABLE_SCHEMA = DATABASE()
                    AND TABLE_NAME = 'awards_category_result'
                  GROUP BY INDEX_NAME
                  HAVING COUNT(*) = 1
              )
            LIMIT 1`,
        );
        if (uniqueCategory == null) {
            await runner.query(
                "ALTER TABLE `awards_category_result` ADD UNIQUE KEY `UQ_awards_category_result_category` (`categoryId`)",
            );
        }

        await runner.query(
            "ALTER TABLE `awards_category_result_winner` ADD `playedVotes` int NOT NULL DEFAULT 0, ADD `playedVotesPercentage` float NOT NULL DEFAULT 0",
        );
        await runner.query(
            "ALTER TABLE `year_recap` ADD `totalFinishedGames` int NOT NULL DEFAULT 0, ADD `totalDroppedGames` int NOT NULL DEFAULT 0, ADD `isFinal` tinyint(1) NOT NULL DEFAULT 0, ADD `dailyPlaytimeSeconds` json NULL, ADD `communityHighlights` json NULL",
        );
        await runner.query(
            "ALTER TABLE `year_recap_played_game` ADD `firstPlayedAt` date NULL, ADD `finishedAt` datetime NULL, ADD `rating` float NULL",
        );

        await runner.query(`CREATE TABLE \`awards_nomination\` (
            \`id\` int NOT NULL AUTO_INCREMENT,
            \`categoryId\` int NOT NULL,
            \`gameId\` bigint NOT NULL,
            \`profileUserId\` varchar(36) NOT NULL,
            \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            PRIMARY KEY (\`id\`),
            UNIQUE KEY \`UQ_awards_nomination_category_profile_game\` (\`categoryId\`,\`profileUserId\`,\`gameId\`),
            KEY \`IDX_awards_nomination_game\` (\`gameId\`),
            CONSTRAINT \`FK_awards_nomination_category\` FOREIGN KEY (\`categoryId\`) REFERENCES \`awards_category\` (\`id\`) ON DELETE CASCADE,
            CONSTRAINT \`FK_awards_nomination_game\` FOREIGN KEY (\`gameId\`) REFERENCES \`game\` (\`id\`),
            CONSTRAINT \`FK_awards_nomination_profile\` FOREIGN KEY (\`profileUserId\`) REFERENCES \`profile\` (\`userId\`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
        await runner.query(`CREATE TABLE \`year_recap_edition\` (
            \`year\` int NOT NULL,
            \`opensAt\` datetime NOT NULL,
            \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            PRIMARY KEY (\`year\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
        await runner.query(`CREATE TABLE \`year_goal\` (
            \`profileUserId\` varchar(36) NOT NULL,
            \`year\` int NOT NULL,
            \`finishedGamesTarget\` int NOT NULL,
            \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            PRIMARY KEY (\`profileUserId\`,\`year\`),
            CONSTRAINT \`FK_year_goal_profile\` FOREIGN KEY (\`profileUserId\`) REFERENCES \`profile\` (\`userId\`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
        await runner.query(`CREATE TABLE \`notification_campaign\` (
            \`key\` varchar(255) NOT NULL,
            \`eventType\` varchar(64) NOT NULL,
            \`payload\` json NOT NULL,
            \`cursorUserId\` varchar(36) DEFAULT NULL,
            \`completedAt\` timestamp(3) NULL DEFAULT NULL,
            \`createdAt\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            PRIMARY KEY (\`key\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    }

    async down(runner: QueryRunner): Promise<void> {
        await runner.query("DROP TABLE `awards_nomination`");
        await runner.query("DROP TABLE `year_recap_edition`");
        await runner.query("DROP TABLE `year_goal`");
        await runner.query("DROP TABLE `notification_campaign`");

        const [uniqueCategory] = await runner.query(
            `SELECT 1 FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'awards_category_result'
              AND INDEX_NAME = 'UQ_awards_category_result_category'
            LIMIT 1`,
        );
        if (uniqueCategory != null) {
            await runner.query(
                "ALTER TABLE `awards_category_result` DROP KEY `UQ_awards_category_result_category`",
            );
        }

        await runner.query(
            "ALTER TABLE `year_recap_played_game` DROP COLUMN `firstPlayedAt`, DROP COLUMN `finishedAt`, DROP COLUMN `rating`",
        );
        await runner.query(
            "ALTER TABLE `year_recap` DROP COLUMN `totalFinishedGames`, DROP COLUMN `totalDroppedGames`, DROP COLUMN `isFinal`, DROP COLUMN `dailyPlaytimeSeconds`, DROP COLUMN `communityHighlights`",
        );
        await runner.query(
            "ALTER TABLE `awards_category_result_winner` DROP COLUMN `playedVotes`, DROP COLUMN `playedVotesPercentage`",
        );
        await runner.query(
            "ALTER TABLE `awards_category_result` DROP COLUMN `totalPlayedVotesCount`",
        );
        await runner.query(
            "ALTER TABLE `awards_category` DROP COLUMN `nomineeCount`, DROP COLUMN `nomineesFinalizedAt`",
        );
        await runner.query(
            "ALTER TABLE `awards_event` DROP COLUMN `nominationStartDate`, DROP COLUMN `nominationEndDate`, DROP COLUMN `eligibilityCutoffDate`",
        );
    }
}
