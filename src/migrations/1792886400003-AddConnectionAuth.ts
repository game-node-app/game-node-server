import { MigrationInterface, QueryRunner } from "typeorm";

export class AddConnectionAuth1792886400003 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE user_connection
            ADD authStatus VARCHAR(32) NOT NULL DEFAULT 'connected'`);
        await queryRunner.query(`CREATE TABLE user_connection_credential (
            connectionId INT NOT NULL,
            accessTokenEncrypted TEXT NOT NULL,
            refreshTokenEncrypted TEXT NULL,
            expiresAt DATETIME(3) NULL,
            refreshTokenExpiresAt DATETIME(3) NULL,
            providerMetadataEncrypted TEXT NULL,
            updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                ON UPDATE CURRENT_TIMESTAMP(3),
            PRIMARY KEY (connectionId),
            CONSTRAINT FK_user_connection_credential FOREIGN KEY (connectionId)
                REFERENCES user_connection(id) ON DELETE CASCADE
        ) ENGINE=InnoDB`);
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query("DROP TABLE user_connection_credential");
        await queryRunner.query(
            "ALTER TABLE user_connection DROP COLUMN authStatus",
        );
    }
}
