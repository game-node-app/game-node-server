export interface CatalogFixture {
    seed: number;
    games: number;
    updatedAt?: number;
}
export const fixtureId = (index: number, seed: number) =>
    (seed % 997) + 3 * (index + 1);
export function fixtureGame(index: number, seed: number) {
    const id = fixtureId(index, seed);
    const next = fixtureId(index + 1, seed);
    const genre = ((index + seed) % 3) + 1;
    return {
        id,
        name: `Fixture ${id}`,
        slug: `fixture-${id}`,
        checksum: `fixture-${seed}-${id}`,
        updated_at: 1700000000,
        cover: {
            id: id * 10 + 1,
            image_id: `cover-${id}`,
            checksum: `cover-${id}`,
            width: 100,
            height: 150,
        },
        genres: [
            {
                id: genre,
                name: `Genre ${genre}`,
                slug: `genre-${genre}`,
                checksum: `genre-${genre}`,
            },
        ],
        dlcs: [{ id: next, name: `Fixture ${next}`, slug: `fixture-${next}` }],
    };
}
export function fixtureResponse(query: string, fixture: CatalogFixture) {
    const game = (index: number) => ({
        ...fixtureGame(index, fixture.seed),
        updated_at: fixture.updatedAt ?? 1700000000,
    });
    if (query === "fields id; sort id desc; limit 1;")
        return fixture.games
            ? [{ id: fixtureId(fixture.games - 1, fixture.seed) }]
            : [];
    const ids = /where id = \(([0-9,]+)\)/.exec(query);
    if (ids)
        return ids[1]
            .split(",")
            .map(Number)
            .flatMap((id) => {
                const index = (id - (fixture.seed % 997)) / 3 - 1;
                return Number.isInteger(index) &&
                    index >= 0 &&
                    index < fixture.games
                    ? [game(index)]
                    : [];
            });
    const delta =
        /where updated_at >= (\d+) & updated_at < (\d+) & id > (\d+); sort id asc; limit (\d+);$/.exec(
            query,
        );
    if (delta) {
        const [, start, end, after, limit] = delta.map(Number);
        if (
            (fixture.updatedAt ?? 1700000000) < start ||
            (fixture.updatedAt ?? 1700000000) >= end
        )
            return [];
        const index = Math.max(
            0,
            Math.floor((after - (fixture.seed % 997)) / 3),
        );
        return Array.from(
            { length: Math.max(0, Math.min(limit, fixture.games - index)) },
            (_, offset) => game(index + offset),
        );
    }
    const match =
        /(?:sort id asc; )?where id > (\d+) & id <= (\d+); (?:sort id asc; )?limit (\d+);$/.exec(
            query,
        );
    if (!match) throw new Error("Fixture requires an ordered bounded-ID query");
    const [, after, upper, rawLimit] = match;
    const limit = Number(rawLimit);
    if (limit < 1 || limit > 500) throw new Error("Invalid fixture page size");
    const offset = fixture.seed % 997;
    const start = Math.max(0, Math.floor((Number(after) - offset) / 3));
    const end = Math.min(
        fixture.games,
        Math.floor((Number(upper) - offset) / 3),
        start + limit,
    );
    return Array.from({ length: Math.max(0, end - start) }, (_, index) =>
        game(start + index),
    );
}
export function fixtureExpected(fixture: CatalogFixture) {
    return {
        cursor: fixture.games ? fixtureId(fixture.games - 1, fixture.seed) : 0,
        games: fixture.games,
        gameRows: fixture.games ? fixture.games + 1 : 0,
        statisticsRows: fixture.games ? fixture.games + 1 : 0,
        covers: fixture.games,
        genres: Math.min(3, fixture.games),
    };
}
