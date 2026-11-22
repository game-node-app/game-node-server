import { MigrationInterface, QueryRunner } from "typeorm";

/** achievement_definition.category; mirrors AchievementCategory.COLLECTIONS without importing live code. */
const COLLECTIONS_CATEGORY = 0;

const STARTER_ACHIEVEMENT_ID = "guild-archaeologist";

const STARTER_REWARDS: Array<{
    id: string;
    key: string;
    kind: string;
    achievementId: string | null;
    inChestPool: number;
    chestBonusXp: number;
}> = [
    {
        id: "10eb428e-4e91-407a-ae53-04184f12838d",
        key: "badge_archaeologist",
        kind: "badge",
        achievementId: STARTER_ACHIEVEMENT_ID,
        inChestPool: 0,
        chestBonusXp: 0,
    },
    {
        id: "ae5accd3-8e22-4aff-aa92-290b32e06cb4",
        key: "title_chronist",
        kind: "title",
        achievementId: null,
        inChestPool: 0,
        chestBonusXp: 0,
    },
    {
        id: "95329177-3d0c-4ade-8087-2ba47f73be40",
        key: "weekly_chest",
        kind: "weekly_chest",
        achievementId: null,
        inChestPool: 0,
        chestBonusXp: 75,
    },
    {
        id: "2c59c251-d2f4-423b-8f2e-a4d14dbd4de7",
        key: "title_backlog_slayer",
        kind: "title",
        achievementId: null,
        inChestPool: 1,
        chestBonusXp: 0,
    },
    {
        id: "c1f7214a-d663-4ce1-93d8-1ebdd2717bf1",
        key: "title_guild_veteran",
        kind: "title",
        achievementId: null,
        inChestPool: 1,
        chestBonusXp: 0,
    },
    {
        id: "091c8a5e-9be5-4fce-85dc-d35edb5d3bb0",
        key: "frame_parchment_seal",
        kind: "avatar_frame",
        achievementId: null,
        inChestPool: 1,
        chestBonusXp: 0,
    },
    {
        id: "6cda206d-e041-459b-b0cd-d05d7b89a69e",
        key: "frame_lantern_glow",
        kind: "avatar_frame",
        achievementId: null,
        inChestPool: 1,
        chestBonusXp: 0,
    },
];

/**
 * Adventurers Guild schema, profile cosmetic columns and starter catalog (design 1).
 *
 * MySQL commits DDL implicitly, so a failed run leaves the steps before the failure applied.
 * Tables use CREATE TABLE IF NOT EXISTS, columns are checked first and the seeds use INSERT IGNORE,
 * so a retry after a partial failure finishes the rest.
 */
export class AddAdventurersGuild1795900000000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        await runner.query(`CREATE TABLE IF NOT EXISTS \`guild_profile\` (
            \`profileUserId\` varchar(36) NOT NULL,
            \`licenseNumber\` int unsigned NOT NULL AUTO_INCREMENT,
            \`xp\` int unsigned NOT NULL DEFAULT 0,
            \`rank\` varchar(4) NOT NULL DEFAULT 'E',
            \`lastBoardSeenAt\` datetime(6) NULL DEFAULT NULL,
            \`lastVisitedAt\` datetime(6) NULL DEFAULT NULL,
            \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            PRIMARY KEY (\`profileUserId\`),
            UNIQUE KEY \`UQ_guild_profile_license_number\` (\`licenseNumber\`),
            CONSTRAINT \`FK_guild_profile_profile\` FOREIGN KEY (\`profileUserId\`) REFERENCES \`profile\` (\`userId\`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);

        await runner.query(`CREATE TABLE IF NOT EXISTS \`guild_reward\` (
            \`id\` varchar(36) NOT NULL,
            \`key\` varchar(64) NOT NULL,
            \`kind\` varchar(24) NOT NULL,
            \`achievementId\` varchar(36) NULL DEFAULT NULL,
            \`inChestPool\` tinyint NOT NULL DEFAULT 0,
            \`chestBonusXp\` int unsigned NOT NULL DEFAULT 0,
            \`isActive\` tinyint NOT NULL DEFAULT 1,
            \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            PRIMARY KEY (\`id\`),
            UNIQUE KEY \`UQ_guild_reward_key\` (\`key\`),
            KEY \`FK_guild_reward_achievement\` (\`achievementId\`),
            CONSTRAINT \`FK_guild_reward_achievement\` FOREIGN KEY (\`achievementId\`) REFERENCES \`achievement_definition\` (\`id\`) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);

        await runner.query(`CREATE TABLE IF NOT EXISTS \`user_guild_reward\` (
            \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
            \`profileUserId\` varchar(36) NOT NULL,
            \`rewardId\` varchar(36) NOT NULL,
            \`sourceContractId\` varchar(36) NULL DEFAULT NULL,
            \`unlockedAt\` datetime(6) NOT NULL,
            PRIMARY KEY (\`id\`),
            UNIQUE KEY \`UQ_user_guild_reward_profile_reward\` (\`profileUserId\`, \`rewardId\`),
            KEY \`FK_user_guild_reward_reward\` (\`rewardId\`),
            CONSTRAINT \`FK_user_guild_reward_profile\` FOREIGN KEY (\`profileUserId\`) REFERENCES \`profile\` (\`userId\`) ON DELETE CASCADE,
            CONSTRAINT \`FK_user_guild_reward_reward\` FOREIGN KEY (\`rewardId\`) REFERENCES \`guild_reward\` (\`id\`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);

        await runner.query(`CREATE TABLE IF NOT EXISTS \`guild_event\` (
            \`id\` varchar(36) NOT NULL,
            \`slug\` varchar(64) NOT NULL,
            \`title\` varchar(120) NOT NULL,
            \`description\` varchar(500) NOT NULL,
            \`rank\` varchar(4) NOT NULL,
            \`xpReward\` int unsigned NOT NULL,
            \`objectiveType\` varchar(32) NOT NULL,
            \`targetCount\` int unsigned NOT NULL DEFAULT 1,
            \`criteria\` json NOT NULL,
            \`rewardId\` varchar(36) NULL DEFAULT NULL,
            \`startsAt\` datetime NOT NULL,
            \`endsAt\` datetime NOT NULL,
            \`status\` varchar(16) NOT NULL DEFAULT 'draft',
            \`publishedAt\` datetime NULL DEFAULT NULL,
            \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            PRIMARY KEY (\`id\`),
            UNIQUE KEY \`UQ_guild_event_slug\` (\`slug\`),
            KEY \`IDX_guild_event_status_window\` (\`status\`, \`startsAt\`, \`endsAt\`),
            KEY \`FK_guild_event_reward\` (\`rewardId\`),
            CONSTRAINT \`FK_guild_event_reward\` FOREIGN KEY (\`rewardId\`) REFERENCES \`guild_reward\` (\`id\`) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);

        await runner.query(`CREATE TABLE IF NOT EXISTS \`guild_event_translation\` (
            \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
            \`eventId\` varchar(36) NOT NULL,
            \`locale\` varchar(10) NOT NULL,
            \`title\` varchar(120) NOT NULL,
            \`description\` varchar(500) NOT NULL,
            PRIMARY KEY (\`id\`),
            UNIQUE KEY \`UQ_guild_event_translation_event_locale\` (\`eventId\`, \`locale\`),
            CONSTRAINT \`FK_guild_event_translation_event\` FOREIGN KEY (\`eventId\`) REFERENCES \`guild_event\` (\`id\`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);

        await runner.query(`CREATE TABLE IF NOT EXISTS \`guild_board_entry\` (
            \`id\` varchar(36) NOT NULL,
            \`profileUserId\` varchar(36) NOT NULL,
            \`weekStart\` date NOT NULL,
            \`slotIndex\` tinyint unsigned NOT NULL,
            \`category\` varchar(16) NOT NULL,
            \`templateKey\` varchar(64) NOT NULL,
            \`rank\` varchar(4) NOT NULL,
            \`xpReward\` int unsigned NOT NULL,
            \`objectiveType\` varchar(32) NOT NULL,
            \`targetCount\` int unsigned NOT NULL DEFAULT 1,
            \`criteria\` json NOT NULL,
            \`candidateGames\` json NOT NULL,
            \`requiresTargetGame\` tinyint NOT NULL DEFAULT 0,
            \`rewardId\` varchar(36) NULL DEFAULT NULL,
            \`isRecommended\` tinyint NOT NULL DEFAULT 0,
            \`isQuick\` tinyint NOT NULL DEFAULT 0,
            \`expiresAt\` datetime NOT NULL,
            \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            PRIMARY KEY (\`id\`),
            UNIQUE KEY \`UQ_guild_board_entry_user_week_slot\` (\`profileUserId\`, \`weekStart\`, \`slotIndex\`),
            KEY \`FK_guild_board_entry_reward\` (\`rewardId\`),
            CONSTRAINT \`FK_guild_board_entry_profile\` FOREIGN KEY (\`profileUserId\`) REFERENCES \`profile\` (\`userId\`) ON DELETE CASCADE,
            CONSTRAINT \`FK_guild_board_entry_reward\` FOREIGN KEY (\`rewardId\`) REFERENCES \`guild_reward\` (\`id\`) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);

        await runner.query(`CREATE TABLE IF NOT EXISTS \`guild_contract\` (
            \`id\` varchar(36) NOT NULL,
            \`profileUserId\` varchar(36) NOT NULL,
            \`boardEntryId\` varchar(36) NULL DEFAULT NULL,
            \`eventId\` varchar(36) NULL DEFAULT NULL,
            \`category\` varchar(16) NOT NULL,
            \`templateKey\` varchar(64) NULL DEFAULT NULL,
            \`rank\` varchar(4) NOT NULL,
            \`xpReward\` int unsigned NOT NULL,
            \`objectiveType\` varchar(32) NOT NULL,
            \`criteria\` json NOT NULL,
            \`targetGameId\` bigint NULL DEFAULT NULL,
            \`progressCurrent\` int unsigned NOT NULL DEFAULT 0,
            \`progressTarget\` int unsigned NOT NULL DEFAULT 1,
            \`status\` varchar(20) NOT NULL DEFAULT 'active',
            \`rewardId\` varchar(36) NULL DEFAULT NULL,
            \`claimPayload\` json NULL DEFAULT NULL,
            \`acceptedAt\` datetime(6) NOT NULL,
            \`readyAt\` datetime(6) NULL DEFAULT NULL,
            \`claimedAt\` datetime(6) NULL DEFAULT NULL,
            \`expiresAt\` datetime NULL DEFAULT NULL,
            \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            PRIMARY KEY (\`id\`),
            KEY \`IDX_guild_contract_user_status\` (\`profileUserId\`, \`status\`, \`updatedAt\`),
            KEY \`IDX_guild_contract_user_board\` (\`profileUserId\`, \`boardEntryId\`),
            KEY \`IDX_guild_contract_user_event\` (\`profileUserId\`, \`eventId\`),
            KEY \`IDX_guild_contract_status_expires\` (\`status\`, \`expiresAt\`),
            KEY \`FK_guild_contract_board_entry\` (\`boardEntryId\`),
            KEY \`FK_guild_contract_event\` (\`eventId\`),
            KEY \`FK_guild_contract_game\` (\`targetGameId\`),
            KEY \`FK_guild_contract_reward\` (\`rewardId\`),
            CONSTRAINT \`FK_guild_contract_profile\` FOREIGN KEY (\`profileUserId\`) REFERENCES \`profile\` (\`userId\`) ON DELETE CASCADE,
            CONSTRAINT \`FK_guild_contract_board_entry\` FOREIGN KEY (\`boardEntryId\`) REFERENCES \`guild_board_entry\` (\`id\`) ON DELETE SET NULL,
            CONSTRAINT \`FK_guild_contract_event\` FOREIGN KEY (\`eventId\`) REFERENCES \`guild_event\` (\`id\`) ON DELETE SET NULL,
            CONSTRAINT \`FK_guild_contract_game\` FOREIGN KEY (\`targetGameId\`) REFERENCES \`game\` (\`id\`) ON DELETE SET NULL,
            CONSTRAINT \`FK_guild_contract_reward\` FOREIGN KEY (\`rewardId\`) REFERENCES \`guild_reward\` (\`id\`) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);

        await runner.query(`CREATE TABLE IF NOT EXISTS \`game_time_to_beat\` (
            \`gameId\` bigint NOT NULL,
            \`hastilySeconds\` int unsigned NULL DEFAULT NULL,
            \`normallySeconds\` int unsigned NULL DEFAULT NULL,
            \`completelySeconds\` int unsigned NULL DEFAULT NULL,
            \`submitCount\` int unsigned NOT NULL DEFAULT 0,
            \`fetchedAt\` datetime NOT NULL,
            PRIMARY KEY (\`gameId\`),
            KEY \`IDX_game_ttb_normally\` (\`normallySeconds\`),
            CONSTRAINT \`FK_game_time_to_beat_game\` FOREIGN KEY (\`gameId\`) REFERENCES \`game\` (\`id\`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);

        if (!(await runner.hasColumn("profile", "guildTitleKey")))
            await runner.query(
                "ALTER TABLE `profile` ADD COLUMN `guildTitleKey` varchar(64) NULL DEFAULT NULL",
            );
        if (!(await runner.hasColumn("profile", "guildFrameKey")))
            await runner.query(
                "ALTER TABLE `profile` ADD COLUMN `guildFrameKey` varchar(64) NULL DEFAULT NULL",
            );

        const seededAt = new Date();
        await runner.query(
            "INSERT IGNORE INTO achievement_definition (id, name, description, category, metric, criteria, icon, isHidden, status, publishedAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, 'manual', '{}', ?, 0, 'published', ?, ?, ?)",
            [
                STARTER_ACHIEVEMENT_ID,
                "Guild Archaeologist",
                "Finish a long-forgotten backlog game for the Adventurers Guild.",
                COLLECTIONS_CATEGORY,
                JSON.stringify({ kind: "glyph", name: "trophy" }),
                seededAt,
                seededAt,
                seededAt,
            ],
        );
        // INSERT IGNORE keeps a retry idempotent; the unique (definitionId, level) key does the work.
        await runner.query(
            "INSERT IGNORE INTO achievement_tier (definitionId, level, threshold, expReward) VALUES (?, 1, 1, 0)",
            [STARTER_ACHIEVEMENT_ID],
        );

        for (const reward of STARTER_REWARDS)
            await runner.query(
                "INSERT IGNORE INTO guild_reward (id, `key`, kind, achievementId, inChestPool, chestBonusXp, isActive) VALUES (?, ?, ?, ?, ?, ?, 1)",
                [
                    reward.id,
                    reward.key,
                    reward.kind,
                    reward.achievementId,
                    reward.inChestPool,
                    reward.chestBonusXp,
                ],
            );
    }

    async down(runner: QueryRunner): Promise<void> {
        await runner.query("DROP TABLE IF EXISTS `game_time_to_beat`");
        await runner.query("DROP TABLE IF EXISTS `guild_contract`");
        await runner.query("DROP TABLE IF EXISTS `guild_board_entry`");
        await runner.query("DROP TABLE IF EXISTS `guild_event_translation`");
        await runner.query("DROP TABLE IF EXISTS `guild_event`");
        await runner.query("DROP TABLE IF EXISTS `user_guild_reward`");
        await runner.query("DROP TABLE IF EXISTS `guild_reward`");
        await runner.query("DROP TABLE IF EXISTS `guild_profile`");

        if (await runner.hasColumn("profile", "guildTitleKey"))
            await runner.query(
                "ALTER TABLE `profile` DROP COLUMN `guildTitleKey`",
            );
        if (await runner.hasColumn("profile", "guildFrameKey"))
            await runner.query(
                "ALTER TABLE `profile` DROP COLUMN `guildFrameKey`",
            );

        // Keep the achievement when a member already earned it: obtained_achievement has no cascade here.
        await runner.query(
            "DELETE d FROM achievement_definition d WHERE d.id = ? AND NOT EXISTS (SELECT 1 FROM obtained_achievement o WHERE o.achievementId = d.id)",
            [STARTER_ACHIEVEMENT_ID],
        );
    }
}
