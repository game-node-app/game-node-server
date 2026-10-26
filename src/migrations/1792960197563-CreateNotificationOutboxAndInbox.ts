import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateNotificationOutboxAndInbox1792960197563 implements MigrationInterface {
    name = 'CreateNotificationOutboxAndInbox1792960197563'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`notification_outbox\` (\`id\` varchar(255) NOT NULL, \`eventType\` varchar(64) NOT NULL, \`eventVersion\` int NOT NULL DEFAULT '1', \`occurredAt\` timestamp NOT NULL, \`recipientUserId\` varchar(255) NULL, \`actorUserId\` varchar(255) NULL, \`payload\` json NOT NULL, \`state\` varchar(32) NOT NULL DEFAULT 'pending', \`ownerToken\` varchar(255) NULL, \`ownerExpiresAt\` timestamp NULL, \`attempts\` int NOT NULL DEFAULT '0', \`nextAttemptAt\` timestamp NOT NULL, \`completedAt\` timestamp NULL, \`lastError\` text NULL, \`createdAt\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`IDX_notification_outbox_owner\` (\`ownerToken\`), INDEX \`IDX_notification_outbox_lease\` (\`state\`, \`ownerExpiresAt\`), INDEX \`IDX_notification_outbox_due\` (\`state\`, \`nextAttemptAt\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`notification_inbox\` (\`id\` int NOT NULL AUTO_INCREMENT, \`recipientUserId\` varchar(255) NOT NULL, \`groupKey\` varchar(255) NOT NULL, \`type\` varchar(64) NOT NULL, \`subjectType\` varchar(64) NULL, \`subjectId\` varchar(255) NULL, \`rootType\` varchar(64) NULL, \`rootId\` varchar(255) NULL, \`preview\` json NULL, \`target\` json NULL, \`actorIds\` json NOT NULL, \`eventCount\` int NOT NULL DEFAULT '1', \`actorCount\` int NOT NULL DEFAULT '1', \`lastEventAt\` timestamp NOT NULL, \`version\` int NOT NULL DEFAULT '1', \`readVersion\` int NOT NULL DEFAULT '0', \`isVisible\` tinyint NOT NULL DEFAULT 1, \`isRedacted\` tinyint NOT NULL DEFAULT 0, \`createdAt\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`IDX_notification_inbox_root\` (\`rootType\`, \`rootId\`), INDEX \`IDX_notification_inbox_subject\` (\`subjectType\`, \`subjectId\`), INDEX \`IDX_notification_inbox_unread\` (\`recipientUserId\`, \`isVisible\`, \`readVersion\`, \`version\`), INDEX \`IDX_notification_inbox_pagination\` (\`recipientUserId\`, \`lastEventAt\`, \`id\`), UNIQUE INDEX \`UQ_notification_inbox_recipient_group\` (\`recipientUserId\`, \`groupKey\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`notification_event\` (\`id\` int NOT NULL AUTO_INCREMENT, \`eventId\` varchar(255) NOT NULL, \`recipientUserId\` varchar(255) NOT NULL, \`groupKey\` varchar(255) NOT NULL, \`eventType\` varchar(64) NOT NULL, \`actorUserId\` varchar(255) NULL, \`subjectType\` varchar(64) NULL, \`subjectId\` varchar(255) NULL, \`rootType\` varchar(64) NULL, \`rootId\` varchar(255) NULL, \`preview\` json NULL, \`target\` json NULL, \`occurredAt\` timestamp NOT NULL, \`createdAt\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX \`IDX_notification_event_root\` (\`rootType\`, \`rootId\`), INDEX \`IDX_notification_event_subject\` (\`subjectType\`, \`subjectId\`), INDEX \`IDX_notification_event_group_actor\` (\`groupKey\`, \`actorUserId\`), INDEX \`IDX_notification_event_recipient_group\` (\`recipientUserId\`, \`groupKey\`), INDEX \`IDX_notification_event_group\` (\`groupKey\`), UNIQUE INDEX \`UQ_notification_event_recipient\` (\`eventId\`, \`recipientUserId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`UQ_notification_event_recipient\` ON \`notification_event\``);
        await queryRunner.query(`DROP INDEX \`IDX_notification_event_group\` ON \`notification_event\``);
        await queryRunner.query(`DROP INDEX \`IDX_notification_event_recipient_group\` ON \`notification_event\``);
        await queryRunner.query(`DROP INDEX \`IDX_notification_event_group_actor\` ON \`notification_event\``);
        await queryRunner.query(`DROP INDEX \`IDX_notification_event_subject\` ON \`notification_event\``);
        await queryRunner.query(`DROP INDEX \`IDX_notification_event_root\` ON \`notification_event\``);
        await queryRunner.query(`DROP TABLE \`notification_event\``);
        await queryRunner.query(`DROP INDEX \`UQ_notification_inbox_recipient_group\` ON \`notification_inbox\``);
        await queryRunner.query(`DROP INDEX \`IDX_notification_inbox_pagination\` ON \`notification_inbox\``);
        await queryRunner.query(`DROP INDEX \`IDX_notification_inbox_unread\` ON \`notification_inbox\``);
        await queryRunner.query(`DROP INDEX \`IDX_notification_inbox_subject\` ON \`notification_inbox\``);
        await queryRunner.query(`DROP INDEX \`IDX_notification_inbox_root\` ON \`notification_inbox\``);
        await queryRunner.query(`DROP TABLE \`notification_inbox\``);
        await queryRunner.query(`DROP INDEX \`IDX_notification_outbox_due\` ON \`notification_outbox\``);
        await queryRunner.query(`DROP INDEX \`IDX_notification_outbox_lease\` ON \`notification_outbox\``);
        await queryRunner.query(`DROP INDEX \`IDX_notification_outbox_owner\` ON \`notification_outbox\``);
        await queryRunner.query(`DROP TABLE \`notification_outbox\``);
    }

}
