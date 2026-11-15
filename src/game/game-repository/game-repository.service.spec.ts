import { GameRepositoryService } from "./game-repository.service";

function fixture(rawRows: unknown[]) {
    const getRawMany = jest.fn(async () => rawRows);
    const queryBuilder: any = {
        innerJoin: jest.fn(() => queryBuilder),
        select: jest.fn(() => queryBuilder),
        addSelect: jest.fn(() => queryBuilder),
        where: jest.fn(() => queryBuilder),
        getRawMany,
    };

    const service = new GameRepositoryService(
        {} as never,
        {} as never,
        {} as never,
        { createQueryBuilder: jest.fn(() => queryBuilder) } as never,
        {} as never,
    );

    return { service, queryBuilder };
}

describe("GameRepositoryService.findGameGenresByIds", () => {
    it("selects only the game and genre fields through the genres relation", async () => {
        const { service, queryBuilder } = fixture([
            { gameId: "1", genreId: "10", genreName: "RPG" },
        ]);

        const rows = await service.findGameGenresByIds([1, 2]);

        expect(queryBuilder.innerJoin).toHaveBeenCalledWith(
            "game.genres",
            "genre",
        );
        expect(queryBuilder.select).toHaveBeenCalledWith("game.id", "gameId");
        expect(queryBuilder.addSelect).toHaveBeenCalledTimes(2);
        expect(queryBuilder.addSelect).toHaveBeenCalledWith(
            "genre.id",
            "genreId",
        );
        expect(queryBuilder.addSelect).toHaveBeenCalledWith(
            "genre.name",
            "genreName",
        );
        expect(queryBuilder.where).toHaveBeenCalledWith(
            "game.id IN (:...gameIds)",
            { gameIds: [1, 2] },
        );
        // MySQL returns bigint columns as strings.
        expect(rows).toEqual([{ gameId: 1, genreId: 10, genreName: "RPG" }]);
    });
});
