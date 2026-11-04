import {
    fixtureExpected,
    fixtureId,
    fixtureResponse,
} from "./helpers/generated-catalog";

describe("seeded lazy catalog fixtures", () => {
    it("generates sweep pages, ID refreshes and fixed delta windows", () => {
        const fixture = { seed: 42, games: 1000, updatedAt: 1500 };
        const sweep = fixtureResponse(
            "fields id,checksum; where id > 0 & id <= 3042; sort id asc; limit 500;",
            fixture,
        );
        expect(sweep).toHaveLength(500);
        expect(
            fixtureResponse(
                "fields id,name; where id = (45,48); sort id asc; limit 25;",
                fixture,
            ).map((row) => row.id),
        ).toEqual([45, 48]);
        expect(
            fixtureResponse(
                "fields id; where updated_at >= 1000 & updated_at < 2000 & id > 45; sort id asc; limit 25;",
                fixture,
            ),
        ).toHaveLength(25);
        expect(
            fixtureResponse(
                "fields id; where updated_at >= 2000 & updated_at < 3000 & id > 0; sort id asc; limit 25;",
                fixture,
            ),
        ).toEqual([]);
    });
    it("derives deterministic first/last pages and expected counts without catalog allocation", () => {
        const fixture = { seed: 42, games: 25000 };
        const upper = fixtureId(24999, 42);
        const page = (after: number) =>
            fixtureResponse(
                `fields id; sort id asc; where id > ${after} & id <= ${upper}; limit 25;`,
                fixture,
            );
        const first = page(0);
        const last = page(fixtureId(24974, 42));
        expect(first).toHaveLength(25);
        expect(first[0].id).toBe(45);
        expect(last).toHaveLength(25);
        expect(last[24].id).toBe(upper);
        expect(page(upper)).toEqual([]);
        expect(page(0)).toEqual(first);
        expect(fixtureExpected(fixture)).toMatchObject({
            cursor: upper,
            gameRows: 25001,
            statisticsRows: 25001,
            covers: 25000,
            genres: 3,
        });
        expect(
            fixtureResponse("fields id; sort id desc; limit 1;", {
                seed: 42,
                games: 0,
            }),
        ).toEqual([]);
    });
});
