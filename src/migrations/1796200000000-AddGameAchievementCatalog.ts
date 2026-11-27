import { MigrationInterface, QueryRunner } from "typeorm";

/** Stores each external game's achievement list, so reads stop calling the stores. */
export class AddGameAchievementCatalog1796200000000
    implements MigrationInterface
{
    async up(runner: QueryRunner): Promise<void> {
        await runner.query(`CREATE TABLE \`game_achievement_catalog\` (
            \`externalGameId\` bigint NOT NULL,
            \`achievements\` json NOT NULL,
            \`fetchedAt\` datetime(6) NOT NULL,
            PRIMARY KEY (\`externalGameId\`),
            CONSTRAINT \`FK_game_achievement_catalog_externalGameId\` FOREIGN KEY (\`externalGameId\`) REFERENCES \`game_external_game\` (\`id\`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    }

    async down(runner: QueryRunner): Promise<void> {
        await runner.query("DROP TABLE `game_achievement_catalog`");
    }
}
