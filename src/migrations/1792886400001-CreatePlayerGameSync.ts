import { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePlayerGameSync1792886400001 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE player_game_sync (
            connectionId INT NOT NULL,
            externalGameId BIGINT NOT NULL,
            sourceUserId VARCHAR(255) NOT NULL,
            checkedAt DATETIME(3) NULL,
            outcome VARCHAR(16) NOT NULL DEFAULT 'unknown',
            activityFingerprint VARCHAR(64) NULL,
            nextEligibleAt DATETIME(3) NOT NULL,
            reconcileAt DATETIME(3) NOT NULL,
            retryAt DATETIME(3) NULL,
            ownerToken VARCHAR(36) NULL,
            leaseExpiresAt DATETIME(3) NULL,
            attemptStartedAt DATETIME(3) NULL,
            PRIMARY KEY (connectionId, externalGameId),
            INDEX IDX_player_game_external (externalGameId),
            CONSTRAINT FK_player_game_connection FOREIGN KEY (connectionId)
                REFERENCES user_connection(id) ON DELETE CASCADE,
            CONSTRAINT FK_player_game_external FOREIGN KEY (externalGameId)
                REFERENCES game_external_game(id) ON DELETE CASCADE
        ) ENGINE=InnoDB`);
    }
    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query("DROP TABLE player_game_sync");
    }
}
