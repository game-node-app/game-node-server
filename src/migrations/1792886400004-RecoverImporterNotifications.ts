import { MigrationInterface, QueryRunner } from "typeorm";

export class RecoverImporterNotifications1792886400004 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query("ALTER TABLE importer_notified_entry ADD autoImportRetryable TINYINT NOT NULL DEFAULT 0");
        await queryRunner.query("ALTER TABLE importer_watch_notification ADD autoImportFailedCount INT NOT NULL DEFAULT 0, ADD pendingDelivery TINYINT NOT NULL DEFAULT 0, ADD INDEX IDX_importer_pending_delivery (pendingDelivery, id)");
        await queryRunner.query("ALTER TABLE notification ADD deliveryIdentity VARCHAR(255) NULL, ADD UNIQUE INDEX IDX_notification_delivery_identity (deliveryIdentity)");
    }
    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query("ALTER TABLE notification DROP INDEX IDX_notification_delivery_identity, DROP COLUMN deliveryIdentity");
        await queryRunner.query("ALTER TABLE importer_watch_notification DROP INDEX IDX_importer_pending_delivery, DROP COLUMN pendingDelivery, DROP COLUMN autoImportFailedCount");
        await queryRunner.query("ALTER TABLE importer_notified_entry DROP COLUMN autoImportRetryable");
    }
}
