import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateNotificationCutoverLedger1792960197566
    implements MigrationInterface
{
    async up(runner: QueryRunner): Promise<void> {
        await runner.query(`CREATE TABLE IF NOT EXISTS notification_cutover_state (
            id VARCHAR(128) PRIMARY KEY, lastId INT UNSIGNED NOT NULL DEFAULT 0,
            convertedCount INT UNSIGNED NOT NULL DEFAULT 0, excludedCount INT UNSIGNED NOT NULL DEFAULT 0,
            completed TINYINT NOT NULL DEFAULT 0, backupReference VARCHAR(255) NULL
        ) ENGINE=InnoDB`);
        await runner.query(`CREATE TABLE IF NOT EXISTS notification_cutover_exclusion (
            legacyId INT PRIMARY KEY, reason VARCHAR(64) NOT NULL
        ) ENGINE=InnoDB`);
        await runner.query(`CREATE TABLE IF NOT EXISTS notification_cutover_job (
            queueName VARCHAR(64) NOT NULL, jobId VARCHAR(255) NOT NULL, jobName VARCHAR(255) NOT NULL,
            state VARCHAR(32) NOT NULL, payload JSON NOT NULL,
            PRIMARY KEY (queueName, jobId)
        ) ENGINE=InnoDB`);
    }
    async down(): Promise<void> {
        throw new Error(
            "Cutover inventory is durable recovery data; restore the coordinated backup to roll back",
        );
    }
}
