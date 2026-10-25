import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPendingAchievementActivityDelivery1792886400002
    implements MigrationInterface
{
    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE obtained_game_achievement_activity
            ADD COLUMN pendingDelivery TINYINT(1) NOT NULL DEFAULT 0`);
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE obtained_game_achievement_activity
            DROP COLUMN pendingDelivery`);
    }
}
