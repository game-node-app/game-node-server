import { MigrationInterface, QueryRunner } from "typeorm";

export class AddGameVideo1794200000000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        await runner.query(`CREATE TABLE \`game_video\` (
            \`id\` bigint NOT NULL,
            \`name\` text,
            \`videoId\` text,
            \`checksum\` text,
            \`url\` text,
            \`gameId\` bigint DEFAULT NULL,
            PRIMARY KEY (\`id\`),
            KEY \`IDX_game_video_gameId\` (\`gameId\`),
            CONSTRAINT \`FK_game_video_gameId\` FOREIGN KEY (\`gameId\`) REFERENCES \`game\` (\`id\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    }

    async down(runner: QueryRunner): Promise<void> {
        await runner.query("DROP TABLE `game_video`");
    }
}
