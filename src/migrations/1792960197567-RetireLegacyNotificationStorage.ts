import { MigrationInterface, QueryRunner } from "typeorm";
import { assertNotificationCutoverComplete } from "../notifications/notifications-cutover.service";

export class RetireLegacyNotificationStorage1792960197567
    implements MigrationInterface
{
    async up(runner: QueryRunner): Promise<void> {
        if (await runner.hasTable("notification")) {
            await assertNotificationCutoverComplete(runner.manager);
            const [backup] = await runner.query(
                "SELECT backupReference FROM notification_cutover_state WHERE id = 'maintenance' AND completed = 1",
            );
            if (!backup?.backupReference)
                throw new Error(
                    "Verify the coordinated MySQL/Redis backup before destructive notification cleanup",
                );
            await runner.dropTable("notification");
        }
        if (
            await runner.hasColumn(
                "importer_watch_notification",
                "pendingDelivery",
            )
        ) {
            const table = await runner.getTable("importer_watch_notification");
            if (
                table?.indices.some(
                    (index) => index.name === "IDX_importer_pending_delivery",
                )
            )
                await runner.dropIndex(table, "IDX_importer_pending_delivery");
            await runner.dropColumn(
                "importer_watch_notification",
                "pendingDelivery",
            );
        }
    }
    async down(): Promise<void> {
        throw new Error(
            "Destructive notification rollback requires the coordinated database/Redis backup and previous code",
        );
    }
}
