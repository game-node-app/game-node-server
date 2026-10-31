import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Moves platform achievements from code (src/achievements/data) to tables and seeds the 13 legacy ones
 * as published single-tier definitions. Obtained achievements keep their rows and become tier 1.
 * No XP, notifications or activities are produced.
 *
 * Semantic change: "boo" used to require 5 horror games in a single collection; it now counts 5 horror
 * games in the library. Users who already have it are not affected.
 */
const LEGACY: Array<
    [string, string, string, number, string, object, number, number]
> = [
    // id, name, description, category, metric, criteria, threshold, expReward
    ["spooky", "Spooky", "Review an horror game", 2, "reviews_written", { themeIds: [19] }, 1, 50],
    ["delivery-system", "Delivery System", "Review Death Stranding", 2, "reviews_written", { gameIds: [19564, 152063, 228530] }, 1, 100],
    ["take-off", "Take Off", "Have 10 (ten) followers", 1, "followers", {}, 10, 50],
    ["crew", "Crew", "Have 50 (fifty) followers", 1, "followers", {}, 50, 150],
    ["you-are-fireworks", "Baby, you're fireworks!", "Have 100 (a hundred) followers", 1, "followers", {}, 100, 300],
    ["space-station", "Space Station", "Add 100 games to your collections", 0, "library_games", {}, 100, 75],
    ["boo", "Boo!", "Have a collection composing of at least five horror games", 0, "library_games", { themeIds: [19] }, 5, 75],
    ["a-survivor-is-born", "A Survivor is Born", "Have Tomb Raider 2013 in your library", 0, "library_games", { gameIds: [1164] }, 1, 50],
    ["test-lab", "Test Lab", "Become a beta tester of GameNode", 4, "manual", {}, 1, 100],
    ["dna", "DNA", "Contribute to GameNode's source code", 4, "manual", {}, 1, 100],
    ["spaceman", "Spaceman", "Donate to GameNode", 4, "manual", {}, 1, 150],
    ["area-42", "Does this mean something?", "Be a member of Area 42", 4, "manual", {}, 1, 100],
    ["awards_2025", "Awards 2025", "Participate in the 2025 GameNode Awards event", 5, "awards_participation", { year: 2025 }, 1, 1000],
];

export class ReworkPlatformAchievements1793600000000
    implements MigrationInterface
{
    name = "ReworkPlatformAchievements1793600000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Fail before any DDL instead of dropping obtained achievements without a definition.
        const orphans = await queryRunner.query(
            "SELECT DISTINCT achievementId FROM obtained_achievement WHERE achievementId NOT IN (?)",
            [LEGACY.map(([id]) => id)],
        );
        if (orphans.length > 0) {
            throw new Error(
                `obtained_achievement has unknown achievement ids: ${orphans.map((row: any) => row.achievementId).join(", ")}`,
            );
        }

        await queryRunner.query(`CREATE TABLE \`achievement_event\` (\`id\` varchar(36) NOT NULL, \`slug\` varchar(64) NOT NULL, \`name\` varchar(100) NOT NULL, \`description\` varchar(500) NOT NULL, \`startsAt\` datetime NOT NULL, \`endsAt\` datetime NOT NULL, \`status\` varchar(16) NOT NULL DEFAULT 'draft', \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`IDX_cbb6fea70976cce0f59782e315\` (\`slug\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`achievement_tier\` (\`id\` int NOT NULL AUTO_INCREMENT, \`definitionId\` varchar(36) NOT NULL, \`level\` int NOT NULL, \`threshold\` int NOT NULL, \`expReward\` int NOT NULL, \`obtainedCount\` int NOT NULL DEFAULT '0', UNIQUE INDEX \`IDX_77743d41ed7121a58c08bb60df\` (\`definitionId\`, \`level\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`achievement_definition\` (\`id\` varchar(36) NOT NULL, \`name\` varchar(100) NOT NULL, \`description\` varchar(500) NOT NULL, \`category\` int NOT NULL, \`metric\` varchar(64) NOT NULL, \`criteria\` json NOT NULL, \`startsAt\` datetime NULL, \`endsAt\` datetime NULL, \`eventId\` varchar(36) NULL, \`icon\` json NOT NULL, \`isHidden\` tinyint NOT NULL DEFAULT 0, \`status\` varchar(16) NOT NULL DEFAULT 'draft', \`publishedAt\` datetime NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`achievement_progress\` (\`profileUserId\` varchar(36) NOT NULL, \`definitionId\` varchar(36) NOT NULL, \`value\` int NOT NULL DEFAULT '0', \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY (\`profileUserId\`, \`definitionId\`)) ENGINE=InnoDB`);
        // Existing rows become tier 1 through the column default.
        await queryRunner.query(`ALTER TABLE \`obtained_achievement\` ADD \`tier\` int NOT NULL DEFAULT '1'`);
        await queryRunner.query(`ALTER TABLE \`activity\` ADD \`obtainedAchievementId\` int NULL`);
        await queryRunner.query(`DROP INDEX \`IDX_694f87f24a9e9de0f08ad4c845\` ON \`obtained_achievement\``);
        await queryRunner.query(`CREATE UNIQUE INDEX \`IDX_7bb5560fd213241f2437b7b02f\` ON \`obtained_achievement\` (\`achievementId\`, \`profileUserId\`, \`tier\`)`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`IDX_d7fbe07f35ffe47310fa7ac69a\` ON \`activity\` (\`profileUserId\`, \`obtainedAchievementId\`)`);
        await queryRunner.query(`ALTER TABLE \`achievement_tier\` ADD CONSTRAINT \`FK_f168b85eb30376cdca53bb8bca6\` FOREIGN KEY (\`definitionId\`) REFERENCES \`achievement_definition\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`achievement_definition\` ADD CONSTRAINT \`FK_4041ddb0e9cee3cf280aea428a7\` FOREIGN KEY (\`eventId\`) REFERENCES \`achievement_event\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`achievement_progress\` ADD CONSTRAINT \`FK_f5e151922f40a24dbba0440b8bf\` FOREIGN KEY (\`profileUserId\`) REFERENCES \`profile\`(\`userId\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`achievement_progress\` ADD CONSTRAINT \`FK_17fa71150b23868f99bcbcb47d0\` FOREIGN KEY (\`definitionId\`) REFERENCES \`achievement_definition\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);

        // createdAt follows the legacy array order, which the v1 catalog keeps.
        const seededAt = Date.now();
        for (const [index, [id, name, description, category, metric, criteria, threshold, expReward]] of LEGACY.entries()) {
            const createdAt = new Date(seededAt + index);
            await queryRunner.query(
                "INSERT INTO achievement_definition (id, name, description, category, metric, criteria, icon, isHidden, status, publishedAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'published', ?, ?, ?)",
                [id, name, description, category, metric, JSON.stringify(criteria), JSON.stringify({ kind: "image", name: id }), createdAt, createdAt, createdAt],
            );
            await queryRunner.query(
                "INSERT INTO achievement_tier (definitionId, level, threshold, expReward) VALUES (?, 1, ?, ?)",
                [id, threshold, expReward],
            );
        }
        await queryRunner.query(
            "UPDATE achievement_tier t SET obtainedCount = (SELECT COUNT(*) FROM obtained_achievement o WHERE o.achievementId = t.definitionId AND o.tier = t.level)",
        );

        await queryRunner.query(`ALTER TABLE \`obtained_achievement\` ADD CONSTRAINT \`FK_15c282163af79d1918ae53ef3ce\` FOREIGN KEY (\`achievementId\`) REFERENCES \`achievement_definition\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`activity\` ADD CONSTRAINT \`FK_8b374c34577631acae22f82a00e\` FOREIGN KEY (\`obtainedAchievementId\`) REFERENCES \`obtained_achievement\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    /**
     * Loses tiers above 1, achievements created after the migration and their unlock activities,
     * so the previous code finds only the legacy shape. XP already granted is kept.
     */
    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query("DELETE FROM activity WHERE obtainedAchievementId IS NOT NULL");
        await queryRunner.query(
            "DELETE FROM obtained_achievement WHERE tier > 1 OR achievementId NOT IN (?)",
            [LEGACY.map(([id]) => id)],
        );
        await queryRunner.query(`ALTER TABLE \`activity\` DROP FOREIGN KEY \`FK_8b374c34577631acae22f82a00e\``);
        await queryRunner.query(`ALTER TABLE \`obtained_achievement\` DROP FOREIGN KEY \`FK_15c282163af79d1918ae53ef3ce\``);
        await queryRunner.query(`ALTER TABLE \`achievement_progress\` DROP FOREIGN KEY \`FK_17fa71150b23868f99bcbcb47d0\``);
        await queryRunner.query(`ALTER TABLE \`achievement_progress\` DROP FOREIGN KEY \`FK_f5e151922f40a24dbba0440b8bf\``);
        await queryRunner.query(`ALTER TABLE \`achievement_definition\` DROP FOREIGN KEY \`FK_4041ddb0e9cee3cf280aea428a7\``);
        await queryRunner.query(`ALTER TABLE \`achievement_tier\` DROP FOREIGN KEY \`FK_f168b85eb30376cdca53bb8bca6\``);
        await queryRunner.query(`DROP INDEX \`IDX_d7fbe07f35ffe47310fa7ac69a\` ON \`activity\``);
        await queryRunner.query(`DROP INDEX \`IDX_7bb5560fd213241f2437b7b02f\` ON \`obtained_achievement\``);
        await queryRunner.query(`CREATE UNIQUE INDEX \`IDX_694f87f24a9e9de0f08ad4c845\` ON \`obtained_achievement\` (\`achievementId\`, \`profileUserId\`)`);
        await queryRunner.query(`ALTER TABLE \`activity\` DROP COLUMN \`obtainedAchievementId\``);
        await queryRunner.query(`ALTER TABLE \`obtained_achievement\` DROP COLUMN \`tier\``);
        await queryRunner.query(`DROP TABLE \`achievement_progress\``);
        await queryRunner.query(`DROP TABLE \`achievement_definition\``);
        await queryRunner.query(`DROP TABLE \`achievement_tier\``);
        await queryRunner.query(`DROP TABLE \`achievement_event\``);
    }
}
