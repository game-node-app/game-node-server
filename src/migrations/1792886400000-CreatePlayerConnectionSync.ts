import { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePlayerConnectionSync1792886400000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE player_connection_sync (
            connectionId INT NOT NULL,
            sourceUserId VARCHAR(255) NOT NULL,
            lastSucceededAt DATETIME(3) NULL,
            nextEligibleAt DATETIME(3) NOT NULL,
            stages JSON NOT NULL,
            outcome VARCHAR(16) NOT NULL DEFAULT 'unknown',
            retryAt DATETIME(3) NULL,
            ownerToken VARCHAR(36) NULL,
            leaseExpiresAt DATETIME(3) NULL,
            attemptStartedAt DATETIME(3) NULL,
            PRIMARY KEY (connectionId),
            INDEX IDX_player_connection_due (nextEligibleAt, connectionId),
            CONSTRAINT FK_player_connection_sync FOREIGN KEY (connectionId)
                REFERENCES user_connection(id) ON DELETE CASCADE
        ) ENGINE=InnoDB`);
    }
    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query("DROP TABLE player_connection_sync");
    }
}
