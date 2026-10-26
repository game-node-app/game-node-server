import { MigrationInterface, QueryRunner } from "typeorm";

const sources = [
    "game",
    "review",
    "activity",
    "post",
    "review_comment",
    "activity_comment",
    "post_comment",
];

export class PrepareStatisticsStorage1792960197568
    implements MigrationInterface
{
    async up(runner: QueryRunner): Promise<void> {
        await runner.query(`CREATE TABLE IF NOT EXISTS statistics_target (\n            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,\n            sourceType VARCHAR(32) NOT NULL,\n            isActive TINYINT NOT NULL DEFAULT 1,\n            createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),\n            PRIMARY KEY (id), INDEX IDX_statistics_target_active (isActive, id)\n        ) ENGINE=InnoDB`);
        await runner.query(`CREATE TABLE IF NOT EXISTS engagement_state (\n            targetId BIGINT UNSIGNED NOT NULL,\n            profileUserId VARCHAR(36) NOT NULL,\n            likedAt DATETIME(6) NULL,\n            firstLikedAt DATETIME(6) NULL,\n            lastViewedAt DATETIME(6) NULL,\n            PRIMARY KEY (targetId, profileUserId),\n            INDEX IDX_engagement_state_actor (profileUserId, targetId),\n            CONSTRAINT FK_engagement_state_target FOREIGN KEY (targetId) REFERENCES statistics_target(id) ON DELETE RESTRICT,\n            CONSTRAINT FK_engagement_state_profile FOREIGN KEY (profileUserId) REFERENCES profile(userId) ON DELETE CASCADE\n        ) ENGINE=InnoDB`);
        await runner.query(`CREATE TABLE IF NOT EXISTS statistics_event (\n            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,\n            eventKey VARCHAR(255) NOT NULL,\n            eventVersion TINYINT UNSIGNED NOT NULL DEFAULT 1,\n            eventKind VARCHAR(32) NOT NULL,\n            targetId BIGINT UNSIGNED NOT NULL,\n            actorUserId VARCHAR(36) NULL,\n            occurredAt DATETIME(6) NOT NULL,\n            recordedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),\n            provenance VARCHAR(32) NOT NULL DEFAULT 'live',\n            firstLikeCredit TINYINT NOT NULL DEFAULT 0,\n            projectionState VARCHAR(16) NOT NULL DEFAULT 'pending',\n            attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,\n            nextAttemptAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),\n            lastError VARCHAR(240) NULL,\n            PRIMARY KEY (id), UNIQUE KEY UQ_statistics_event_key (eventKey),\n            INDEX IDX_statistics_event_due (projectionState, nextAttemptAt, id),\n            INDEX IDX_statistics_event_target_time (targetId, occurredAt, id),\n            INDEX IDX_statistics_event_actor_kind_time (actorUserId, eventKind, occurredAt),\n            INDEX IDX_statistics_event_state_time (projectionState, occurredAt),\n            CONSTRAINT FK_statistics_event_target FOREIGN KEY (targetId) REFERENCES statistics_target(id) ON DELETE RESTRICT\n        ) ENGINE=InnoDB`);
        await runner.query(`CREATE TABLE IF NOT EXISTS metric_total (\n            targetId BIGINT UNSIGNED NOT NULL,\n            metricCode VARCHAR(32) NOT NULL,\n            metricValue BIGINT UNSIGNED NOT NULL DEFAULT 0,\n            PRIMARY KEY (targetId, metricCode),\n            CONSTRAINT FK_metric_total_target FOREIGN KEY (targetId) REFERENCES statistics_target(id) ON DELETE RESTRICT\n        ) ENGINE=InnoDB`);
        await runner.query(`CREATE TABLE IF NOT EXISTS metric_hour (\n            targetId BIGINT UNSIGNED NOT NULL,\n            metricCode VARCHAR(32) NOT NULL,\n            bucketStart DATETIME(6) NOT NULL,\n            metricValue BIGINT UNSIGNED NOT NULL DEFAULT 0,\n            PRIMARY KEY (targetId, metricCode, bucketStart),\n            INDEX IDX_metric_hour_metric_bucket_target (metricCode, bucketStart, targetId),\n            CONSTRAINT FK_metric_hour_target FOREIGN KEY (targetId) REFERENCES statistics_target(id) ON DELETE RESTRICT\n        ) ENGINE=InnoDB`);
        await runner.query(`CREATE TABLE IF NOT EXISTS ranking_score (\n            rankingKey VARCHAR(32) NOT NULL,\n            targetId BIGINT UNSIGNED NOT NULL,\n            score DOUBLE NOT NULL DEFAULT 0,\n            definitionVersion VARCHAR(32) NOT NULL,\n            computedAt DATETIME(6) NOT NULL,\n            PRIMARY KEY (rankingKey, targetId),\n            INDEX IDX_ranking_score_order (rankingKey, score, targetId),\n            CONSTRAINT FK_ranking_score_target FOREIGN KEY (targetId) REFERENCES statistics_target(id) ON DELETE RESTRICT\n        ) ENGINE=InnoDB`);
        await runner.query(`CREATE TABLE IF NOT EXISTS statistics_maintenance (\n            id VARCHAR(64) NOT NULL,\n            operation VARCHAR(32) NOT NULL DEFAULT 'idle',\n            \`cursor\` VARCHAR(255) NULL,\n            state VARCHAR(16) NOT NULL DEFAULT 'pending',\n            historyCompleteSince DATETIME(6) NULL,\n            backupReference VARCHAR(255) NULL,\n            report JSON NULL,\n            updatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),\n            PRIMARY KEY (id)\n        ) ENGINE=InnoDB`);
        await runner.query(
            "INSERT IGNORE INTO statistics_maintenance (id, operation, state) VALUES ('main', 'idle', 'pending')",
        );

        for (const source of sources) {
            const table = await runner.getTable(source);
            if (!table) throw new Error(`Missing statistics source table: ${source}`);
            if (!(await runner.hasColumn(source, "statisticsTargetId"))) {
                await runner.query(
                    `ALTER TABLE \`${source}\` ADD statisticsTargetId BIGINT UNSIGNED NULL`,
                );
            }
            const refreshed = await runner.getTable(source);
            const indexName = `UQ_${source}_statistics_target`;
            if (!refreshed?.indices.some((index) => index.name === indexName || (index.isUnique && index.columnNames.join() === "statisticsTargetId"))) {
                await runner.query(
                    `ALTER TABLE \`${source}\` ADD UNIQUE INDEX \`${indexName}\` (statisticsTargetId)`,
                );
            }
            const foreignKeyName = `FK_${source}_statistics_target`;
            if (!refreshed?.foreignKeys.some((key) => key.name === foreignKeyName || (key.columnNames.join() === "statisticsTargetId" && key.referencedTableName === "statistics_target"))) {
                await runner.query(
                    `ALTER TABLE \`${source}\` ADD CONSTRAINT \`${foreignKeyName}\` FOREIGN KEY (statisticsTargetId) REFERENCES statistics_target(id) ON DELETE RESTRICT`,
                );
            }
        }
    }

    async down(runner: QueryRunner): Promise<void> {
        for (const source of [...sources].reverse()) {
            const table = await runner.getTable(source);
            const foreignKeyName = `FK_${source}_statistics_target`;
            const indexName = `UQ_${source}_statistics_target`;
            if (table?.foreignKeys.some((key) => key.name === foreignKeyName))
                await runner.query(
                    `ALTER TABLE \`${source}\` DROP FOREIGN KEY \`${foreignKeyName}\``,
                );
            if (table?.indices.some((index) => index.name === indexName))
                await runner.query(
                    `ALTER TABLE \`${source}\` DROP INDEX \`${indexName}\``,
                );
            if (await runner.hasColumn(source, "statisticsTargetId"))
                await runner.query(
                    `ALTER TABLE \`${source}\` DROP COLUMN statisticsTargetId`,
                );
        }
        for (const table of [
            "statistics_maintenance",
            "ranking_score",
            "metric_hour",
            "metric_total",
            "statistics_event",
            "engagement_state",
            "statistics_target",
        ]) {
            if (await runner.hasTable(table))
                await runner.query(`DROP TABLE IF EXISTS \`${table}\``);
        }
    }
}
