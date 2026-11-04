import { MigrationInterface, QueryRunner } from "typeorm";

export class AddIgdbDeltaSync1794500000000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        await runner.query(
            "ALTER TABLE `game` ADD `igdbUpdatedAt` datetime(3) NULL",
        );
        await runner.query(
            "ALTER TABLE `igdb_catalog_state` ADD `sweepEndpoint` varchar(64) NOT NULL DEFAULT 'games'",
        );
        await runner.query(`CREATE TABLE \`igdb_delta_state\` (
            \`stream\` varchar(64) NOT NULL,
            \`watermark\` datetime(3) DEFAULT NULL,
            \`windowStart\` datetime(3) DEFAULT NULL,
            \`windowEnd\` datetime(3) DEFAULT NULL,
            \`cursor\` int unsigned NOT NULL DEFAULT 0,
            \`failureSummary\` varchar(512) DEFAULT NULL,
            \`pausedUntil\` datetime(3) DEFAULT NULL,
            \`ownerToken\` varchar(36) DEFAULT NULL,
            \`ownerGeneration\` int unsigned NOT NULL DEFAULT 0,
            \`leaseExpiresAt\` datetime(3) DEFAULT NULL,
            PRIMARY KEY (\`stream\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
        await runner.query(
            "INSERT INTO `igdb_delta_state` (`stream`) VALUES ('lease')",
        );
    }

    async down(runner: QueryRunner): Promise<void> {
        await runner.query("DROP TABLE `igdb_delta_state`");
        await runner.query(
            "ALTER TABLE `igdb_catalog_state` DROP COLUMN `sweepEndpoint`",
        );
        await runner.query("ALTER TABLE `game` DROP COLUMN `igdbUpdatedAt`");
    }
}
