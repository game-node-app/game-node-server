import { ResourceBounds } from "./helpers/resource-bounds";

describe("resource checker sensitivity", () => {
    it("tracks independent sweep and delta pages through durable settlement", () => {
        for (const kind of ["sweep", "delta"]) {
            const bounds = new ResourceBounds();
            bounds.pageOpened();
            bounds.gameStarted(1);
            bounds.relationStarted(2);
            bounds.activeRelations--;
            bounds.activeGames--;
            bounds.pageCommitted();
            bounds.pageOpened();
            bounds.pageCommitted();
            expect({
                kind,
                pages: bounds.maxPages,
                games: bounds.maxGames,
                relations: bounds.maxRelations,
            }).toEqual({ kind, pages: 1, games: 1, relations: 1 });
        }
    });
    it("rejects an eager fetcher and an unbounded relationship stub", () => {
        const pages = new ResourceBounds();
        pages.pageOpened();
        expect(() => pages.pageOpened()).toThrow("live catalog page");
        const relations = new ResourceBounds();
        relations.relationStarted(2);
        relations.relationStarted(2);
        expect(() => relations.relationStarted(2)).toThrow(
            "Relationship admission",
        );
    });
});
