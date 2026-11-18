import { In, MoreThanOrEqual } from "typeorm";
import { buildGameFilterFindOptions } from "./build-game-filter-find-options";

describe("buildGameFilterFindOptions", () => {
    it("applies the minimum critic review count alongside relation filters", () => {
        const options = buildGameFilterFindOptions({
            genres: [31],
            minCriticReviewCount: 1,
        });

        expect(options.genres).toEqual({ id: In([31]) });
        expect(options.aggregatedRatingCount).toEqual(MoreThanOrEqual(1));
    });

    it("ignores an invalid minimum critic review count", () => {
        const options = buildGameFilterFindOptions({
            minCriticReviewCount: Number.NaN,
        });

        expect(options.aggregatedRatingCount).toBeUndefined();
    });
});
