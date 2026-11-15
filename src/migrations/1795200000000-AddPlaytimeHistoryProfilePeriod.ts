import { MigrationInterface, QueryRunner } from "typeorm";

/** Covers period totals for callers that filter only by profile user. */
export class AddPlaytimeHistoryProfilePeriod1795200000000
    implements MigrationInterface
{
    async up(runner: QueryRunner): Promise<void> {
        await runner.query(
            "ALTER TABLE `user_playtime_history` ADD KEY `IDX_playtime_history_profile_period` (`profileUserId`, `createdAt`)",
        );
    }

    async down(runner: QueryRunner): Promise<void> {
        await runner.query(
            "ALTER TABLE `user_playtime_history` DROP KEY `IDX_playtime_history_profile_period`",
        );
    }
}
