import { MigrationInterface, QueryRunner } from "typeorm";

export class IndexNotificationCommentTriggers1792960197565
    implements MigrationInterface
{
    async up(runner: QueryRunner): Promise<void> {
        for (const table of ["notification_event", "notification_inbox"]) {
            const kind = table === "notification_event" ? "event" : "inbox";
            await runner.query(
                `ALTER TABLE ${table} ADD triggerCommentId VARCHAR(255) NULL, ADD INDEX IDX_notification_${kind}_trigger (triggerCommentId)`,
            );
            await runner.query(
                `UPDATE ${table} SET triggerCommentId = JSON_UNQUOTE(JSON_EXTRACT(target, '$.focusId')) WHERE JSON_TYPE(JSON_EXTRACT(target, '$.focusId')) = 'STRING'`,
            );
        }
    }

    async down(runner: QueryRunner): Promise<void> {
        for (const table of ["notification_inbox", "notification_event"]) {
            const kind = table === "notification_event" ? "event" : "inbox";
            await runner.query(
                `ALTER TABLE ${table} DROP INDEX IDX_notification_${kind}_trigger, DROP COLUMN triggerCommentId`,
            );
        }
    }
}
