import { MigrationInterface, QueryRunner } from "typeorm";

/** Covers release-window collection scans and batched own-library entry lookups. */
export class AddPerformanceReadIndexes1796100000000
    implements MigrationInterface
{
    async up(runner: QueryRunner): Promise<void> {
        await runner.query(
            "ALTER TABLE `game` ADD KEY `IDX_game_release_category` (`firstReleaseDate`, `category`)",
        );
        await runner.query(
            "ALTER TABLE `collection_entry` ADD KEY `IDX_collection_entry_library_game` (`libraryUserId`, `gameId`)",
        );
    }

    async down(runner: QueryRunner): Promise<void> {
        await runner.query(
            "ALTER TABLE `collection_entry` DROP KEY `IDX_collection_entry_library_game`",
        );
        await runner.query(
            "ALTER TABLE `game` DROP KEY `IDX_game_release_category`",
        );
    }
}
