export interface CatalogFixture {
    seed: number;
    games: number;
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
    if (query === "fields id; sort id desc; limit 1;")
        return fixture.games
            ? [{ id: fixtureId(fixture.games - 1, fixture.seed) }]
            : [];
    const match =
        /sort id asc; where id > (\d+) & id <= (\d+); limit (\d+);$/.exec(
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
        fixtureGame(start + index, fixture.seed),
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
