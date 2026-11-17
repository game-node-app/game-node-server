import { MigrationInterface, QueryRunner } from "typeorm";

export class AddLibraryVisibility1795700000000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        await runner.query(
            "ALTER TABLE `collection_entry` ADD `visibility` varchar(16) NOT NULL DEFAULT 'public'",
        );
        await runner.query(
            "ALTER TABLE `profile` ADD `libraryVisibility` varchar(16) NOT NULL DEFAULT 'public'",
        );
        // Nothing that was hidden by private collections becomes visible.
        await runner.query(`UPDATE \`collection_entry\` e
            SET e.\`visibility\` = 'private'
            WHERE EXISTS (
                SELECT 1 FROM \`collection_entry_collections_collection\` m
                WHERE m.\`collectionEntryId\` = e.\`id\`
            )
            AND NOT EXISTS (
                SELECT 1
                FROM \`collection_entry_collections_collection\` m
                JOIN \`collection\` c ON c.\`id\` = m.\`collectionId\`
                WHERE m.\`collectionEntryId\` = e.\`id\` AND c.\`isPublic\` = 1
            )`);
        await runner.query(
            "ALTER TABLE `collection_entry` ADD KEY `IDX_collection_entry_library_visibility` (`libraryUserId`, `visibility`)",
        );
    }

    async down(runner: QueryRunner): Promise<void> {
        await runner.query(
            "ALTER TABLE `collection_entry` DROP KEY `IDX_collection_entry_library_visibility`",
        );
        await runner.query(
            "ALTER TABLE `collection_entry` DROP COLUMN `visibility`",
        );
        await runner.query(
            "ALTER TABLE `profile` DROP COLUMN `libraryVisibility`",
        );
    }
}
