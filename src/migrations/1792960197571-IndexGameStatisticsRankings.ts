import { MigrationInterface, QueryRunner, TableIndex } from "typeorm";

export class IndexGameStatisticsRankings1792960197571 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        const table = await runner.getTable("game");
        if (!table?.indices.some((index) => index.name === "IDX_game_statistics_ranking"))
            await runner.createIndex("game", new TableIndex({
                name: "IDX_game_statistics_ranking",
                columnNames: ["id", "statisticsTargetId", "status", "category"],
            }));
    }

    async down(runner: QueryRunner): Promise<void> {
        await runner.dropIndex("game", "IDX_game_statistics_ranking");
    }
}
