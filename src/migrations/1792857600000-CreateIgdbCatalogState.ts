import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateIgdbCatalogState1792857600000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE igdb_catalog_state (
            id TINYINT UNSIGNED NOT NULL DEFAULT 1,
            runId VARCHAR(36) NULL,
            status ENUM('idle','running','paused','completed') NOT NULL DEFAULT 'idle',
            committedId INT UNSIGNED NOT NULL DEFAULT 0,
            upperId INT UNSIGNED NULL,
            forceReconciliation TINYINT NOT NULL DEFAULT 1,
            committedGames INT UNSIGNED NOT NULL DEFAULT 0,
            committedBatches INT UNSIGNED NOT NULL DEFAULT 0,
            startedAt DATETIME(3) NULL,
            completedAt DATETIME(3) NULL,
            nextEligibleAt DATETIME(3) NULL,
            retryStage VARCHAR(16) NULL,
            retryGameId INT UNSIGNED NULL,
            attempt TINYINT UNSIGNED NOT NULL DEFAULT 0,
            retryBudgets JSON NULL,
            failureSummary VARCHAR(512) NULL,
            ownerGeneration INT UNSIGNED NOT NULL DEFAULT 0,
            ownerToken VARCHAR(36) NULL,
            leaseExpiresAt DATETIME(3) NULL,
            PRIMARY KEY (id),
            CONSTRAINT CHK_igdb_catalog_singleton CHECK (id = 1)
        ) ENGINE=InnoDB`);
        await queryRunner.query(
            "INSERT INTO igdb_catalog_state (id) VALUES (1)",
        );
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query("DROP TABLE igdb_catalog_state");
    }
}
