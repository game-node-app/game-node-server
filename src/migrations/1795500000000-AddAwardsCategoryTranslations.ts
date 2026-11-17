import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAwardsCategoryTranslations1795500000000
    implements MigrationInterface
{
    async up(runner: QueryRunner): Promise<void> {
        await runner.query(`CREATE TABLE \`awards_category_translation\` (
            \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            \`deletedAt\` datetime(6) DEFAULT NULL,
            \`id\` int NOT NULL AUTO_INCREMENT,
            \`categoryId\` int NOT NULL,
            \`locale\` varchar(8) NOT NULL,
            \`name\` varchar(255) NOT NULL,
            \`description\` text NOT NULL,
            PRIMARY KEY (\`id\`),
            UNIQUE KEY \`UQ_awards_category_translation_category_locale\` (\`categoryId\`,\`locale\`),
            CONSTRAINT \`FK_awards_category_translation_category\` FOREIGN KEY (\`categoryId\`) REFERENCES \`awards_category\` (\`id\`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    }

    async down(runner: QueryRunner): Promise<void> {
        await runner.query("DROP TABLE `awards_category_translation`");
    }
}
