import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateImporterBatchEffects1792960197572 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE importer_batch_effect (
            id varchar(36) NOT NULL,
            libraryUserId varchar(36) NOT NULL,
            entryIds json NOT NULL,
            collectionIds json NOT NULL,
            attempts int NOT NULL DEFAULT 0,
            nextAttemptAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            PRIMARY KEY (id),
            INDEX IDX_importer_batch_effect_due (nextAttemptAt, createdAt),
            CONSTRAINT FK_importer_batch_effect_library FOREIGN KEY (libraryUserId) REFERENCES library(userId) ON DELETE CASCADE
        ) ENGINE=InnoDB`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query("DROP TABLE importer_batch_effect");
    }
}
