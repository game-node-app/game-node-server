import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Library status history (design 11): one row per created or changed collection entry, with
 * server time and origin. The entry FK is SET NULL so history survives deleting the entry;
 * the library FK cascades so deleting the user's library removes it.
 *
 * MySQL commits DDL implicitly, so a failed run leaves the steps before the failure applied.
 * The table uses CREATE TABLE IF NOT EXISTS and the backfill skips existing rows, so a retry
 * after a partial failure finishes the rest.
 */
export class AddLibraryStatusHistory1796000000000
    implements MigrationInterface
{
    async up(runner: QueryRunner): Promise<void> {
        await runner.query(`CREATE TABLE IF NOT EXISTS \`collection_entry_status_history\` (
            \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
            \`libraryUserId\` varchar(36) NOT NULL,
            \`gameId\` bigint NOT NULL,
            \`collectionEntryId\` varchar(36) NULL DEFAULT NULL,
            \`fromStatus\` varchar(32) NULL DEFAULT NULL,
            \`toStatus\` varchar(32) NOT NULL,
            \`source\` varchar(16) NOT NULL,
            \`occurredAt\` datetime(6) NOT NULL,
            PRIMARY KEY (\`id\`),
            KEY \`IDX_ce_status_history_user_game\` (\`libraryUserId\`, \`gameId\`, \`toStatus\`, \`occurredAt\`),
            KEY \`IDX_ce_status_history_user_status\` (\`libraryUserId\`, \`toStatus\`, \`occurredAt\`),
            KEY \`FK_ce_status_history_entry\` (\`collectionEntryId\`),
            CONSTRAINT \`FK_ce_status_history_library\` FOREIGN KEY (\`libraryUserId\`) REFERENCES \`library\` (\`userId\`) ON DELETE CASCADE,
            CONSTRAINT \`FK_ce_status_history_entry\` FOREIGN KEY (\`collectionEntryId\`) REFERENCES \`collection_entry\` (\`id\`) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);

        // shortcut: entries finished before this migration and later moved to another status have no
        // row and can count once as a first finish; reconstruct from activities if that is abused.
        await runner.query(`INSERT INTO \`collection_entry_status_history\`
            (\`libraryUserId\`, \`gameId\`, \`collectionEntryId\`, \`fromStatus\`, \`toStatus\`, \`source\`, \`occurredAt\`)
            SELECT e.\`libraryUserId\`, e.\`gameId\`, e.\`id\`, NULL, 'finished', 'backfill',
                COALESCE(e.\`finishedAt\`, e.\`updatedAt\`, e.\`createdAt\`)
            FROM \`collection_entry\` e
            WHERE e.\`status\` = 'finished'
              AND NOT EXISTS (
                  SELECT 1 FROM \`collection_entry_status_history\` h
                  WHERE h.\`collectionEntryId\` = e.\`id\` AND h.\`toStatus\` = 'finished'
              )`);
    }

    async down(runner: QueryRunner): Promise<void> {
        await runner.query(
            "DROP TABLE IF EXISTS `collection_entry_status_history`",
        );
    }
}
