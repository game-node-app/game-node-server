import { MigrationInterface, QueryRunner } from "typeorm";

/** One row per profile slot; the published video survives while a new attempt runs (design 4). */
export class AddProfileVideo1794800000000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        await runner.query(`CREATE TABLE \`profile_video\` (
            \`id\` int NOT NULL AUTO_INCREMENT,
            \`profileUserId\` varchar(36) NOT NULL,
            \`type\` varchar(16) NOT NULL,
            \`filename\` varchar(255) NULL,
            \`size\` int NULL,
            \`durationMs\` int NULL,
            \`width\` int NULL,
            \`height\` int NULL,
            \`status\` varchar(16) NULL,
            \`attemptId\` varchar(36) NULL,
            \`errorCode\` varchar(32) NULL,
            \`processingStartedAt\` timestamp(3) NULL,
            PRIMARY KEY (\`id\`),
            UNIQUE KEY \`UQ_profile_video_profile_type\` (\`profileUserId\`, \`type\`),
            CONSTRAINT \`FK_profile_video_profile\` FOREIGN KEY (\`profileUserId\`) REFERENCES \`profile\` (\`userId\`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    }

    async down(runner: QueryRunner): Promise<void> {
        await runner.query("DROP TABLE `profile_video`");
    }
}
