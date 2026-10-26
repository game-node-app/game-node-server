import { MigrationInterface, QueryRunner } from "typeorm";

export class NotificationTimestampPrecision1792960197564
    implements MigrationInterface
{
    async up(runner: QueryRunner): Promise<void> {
        await runner.query(
            "ALTER TABLE notification_outbox MODIFY occurredAt TIMESTAMP(3) NOT NULL, MODIFY ownerExpiresAt TIMESTAMP(3) NULL, MODIFY nextAttemptAt TIMESTAMP(3) NOT NULL, MODIFY completedAt TIMESTAMP(3) NULL",
        );
        await runner.query(
            "ALTER TABLE notification_event MODIFY occurredAt TIMESTAMP(3) NOT NULL",
        );
        await runner.query(
            "ALTER TABLE notification_inbox MODIFY lastEventAt TIMESTAMP(3) NOT NULL",
        );
    }

    async down(runner: QueryRunner): Promise<void> {
        await runner.query(
            "ALTER TABLE notification_inbox MODIFY lastEventAt TIMESTAMP NOT NULL",
        );
        await runner.query(
            "ALTER TABLE notification_event MODIFY occurredAt TIMESTAMP NOT NULL",
        );
        await runner.query(
            "ALTER TABLE notification_outbox MODIFY occurredAt TIMESTAMP NOT NULL, MODIFY ownerExpiresAt TIMESTAMP NULL, MODIFY nextAttemptAt TIMESTAMP NOT NULL, MODIFY completedAt TIMESTAMP NULL",
        );
    }
}
