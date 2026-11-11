import { MigrationInterface, QueryRunner } from "typeorm";

/** Design 2: one row per supporter who changed a preference; a missing row means the defaults. */
export class AddSupporterPreferences1795000000000
    implements MigrationInterface
{
    async up(runner: QueryRunner): Promise<void> {
        await runner.query(`CREATE TABLE \`profile_supporter_preferences\` (
            \`profileUserId\` varchar(36) NOT NULL,
            \`showBadge\` boolean NOT NULL DEFAULT true,
            \`titleKey\` varchar(32) NULL DEFAULT NULL,
            \`showAnimatedAvatarBorder\` boolean NOT NULL DEFAULT true,
            \`showSupporterTheme\` boolean NOT NULL DEFAULT true,
            \`accentColor\` char(7) NULL DEFAULT NULL,
            \`showOnSupportersWall\` boolean NOT NULL DEFAULT true,
            \`showLiveProfile\` boolean NOT NULL DEFAULT false,
            PRIMARY KEY (\`profileUserId\`),
            CONSTRAINT \`FK_profile_supporter_preferences_profile\` FOREIGN KEY (\`profileUserId\`) REFERENCES \`profile\` (\`userId\`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    }

    async down(runner: QueryRunner): Promise<void> {
        await runner.query("DROP TABLE `profile_supporter_preferences`");
    }
}
