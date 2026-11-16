import { MigrationInterface, QueryRunner } from "typeorm";

export class AddActivityProfileCreatedIndex1795400000000
    implements MigrationInterface
{
    async up(runner: QueryRunner): Promise<void> {
        await runner.query(
            "ALTER TABLE `activity` ADD KEY `IDX_activity_profile_created` (`profileUserId`, `createdAt`)",
        );
    }

    async down(runner: QueryRunner): Promise<void> {
        await runner.query(
            "ALTER TABLE `activity` DROP KEY `IDX_activity_profile_created`",
        );
    }
}
