import { MigrationInterface, QueryRunner } from "typeorm";

/** Chest-pool cosmetics that bring the starter pool to ten (designs 16 and spec: rewards). */
const CHEST_POOL_REWARDS: Array<{
    id: string;
    key: string;
    kind: string;
}> = [
    {
        id: "d72ad5c6-4f86-4c78-9323-3b35fa626fd3",
        key: "title_relic_hunter",
        kind: "title",
    },
    {
        id: "b8b44efd-5811-480c-ace1-15dc62f1398e",
        key: "title_night_owl",
        kind: "title",
    },
    {
        id: "6e32ad69-350f-4189-aee2-16f510afac90",
        key: "title_completionist",
        kind: "title",
    },
    {
        id: "9cd5996e-1ce6-4f40-ac99-54275322cf51",
        key: "frame_ember_rune",
        kind: "avatar_frame",
    },
    {
        id: "10e9491d-9be0-4372-bcc5-40650c60d367",
        key: "frame_moonlit_ivy",
        kind: "avatar_frame",
    },
    {
        id: "575293ff-af8d-4c0a-824e-6d1c0634e148",
        key: "frame_gilded_compass",
        kind: "avatar_frame",
    },
];

/**
 * Expiry-reminder bookkeeping plus the expanded chest pool (designs 16 and 18).
 *
 * MySQL commits DDL implicitly, so every step checks before writing and the seeds use
 * INSERT IGNORE by key; a retry after a partial failure finishes the rest.
 */
export class HardenAdventurersGuild1796000000001 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        if (!(await runner.hasColumn("guild_contract", "expiringNotifiedAt")))
            await runner.query(
                "ALTER TABLE `guild_contract` ADD COLUMN `expiringNotifiedAt` datetime(6) NULL DEFAULT NULL",
            );

        for (const reward of CHEST_POOL_REWARDS)
            await runner.query(
                "INSERT IGNORE INTO guild_reward (id, `key`, kind, achievementId, inChestPool, chestBonusXp, isActive) VALUES (?, ?, ?, NULL, 1, 0, 1)",
                [reward.id, reward.key, reward.kind],
            );
    }

    async down(runner: QueryRunner): Promise<void> {
        // Keep a reward a member already unlocked: user_guild_reward cascades on reward delete.
        for (const reward of CHEST_POOL_REWARDS)
            await runner.query(
                "DELETE r FROM guild_reward r WHERE r.`key` = ? AND NOT EXISTS (SELECT 1 FROM user_guild_reward u WHERE u.rewardId = r.id)",
                [reward.key],
            );

        if (await runner.hasColumn("guild_contract", "expiringNotifiedAt"))
            await runner.query(
                "ALTER TABLE `guild_contract` DROP COLUMN `expiringNotifiedAt`",
            );
    }
}
