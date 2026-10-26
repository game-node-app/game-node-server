import { DataSource } from "typeorm";

/** One-time conversion fixtures only; these stores are absent from runtime metadata. */
export async function createLegacyNotificationFixtures(source: DataSource) {
    const runner = source.createQueryRunner();
    try {
        await runner.query(`CREATE TABLE IF NOT EXISTS notification (
            id INT PRIMARY KEY AUTO_INCREMENT, sourceType VARCHAR(255) NOT NULL, category VARCHAR(255) NOT NULL,
            postId VARCHAR(255) NULL, reviewId VARCHAR(255) NULL, activityId VARCHAR(255) NULL,
            postCommentId VARCHAR(255) NULL, reviewCommentId VARCHAR(255) NULL, activityCommentId VARCHAR(255) NULL,
            importerNotificationId INT NULL, reportId INT NULL, gameId BIGINT NULL,
            profileUserId VARCHAR(255) NULL, targetProfileUserId VARCHAR(255) NULL, isViewed TINYINT NOT NULL DEFAULT 0,
            createdAt TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), updatedAt TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
        ) ENGINE=InnoDB`);
        if (
            !(await runner.hasColumn(
                "importer_watch_notification",
                "pendingDelivery",
            ))
        ) {
            await runner.query(
                "ALTER TABLE importer_watch_notification ADD pendingDelivery TINYINT NOT NULL DEFAULT 0, ADD INDEX IDX_importer_pending_delivery (pendingDelivery, id)",
            );
        }
    } finally {
        await runner.release();
    }
}
