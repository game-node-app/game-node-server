import {
    fixtureExpected,
    fixtureId,
    fixtureResponse,
} from "./helpers/generated-catalog";

describe("seeded lazy catalog fixtures", () => {
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
