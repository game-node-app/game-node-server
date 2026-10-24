import { ResourceBounds } from "./helpers/resource-bounds";

describe("resource checker sensitivity", () => {
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
