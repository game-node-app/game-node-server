import {
    normalizeIgdbGame,
    normalizeIgdbResults,
    parseGameDates,
    snakeCaseToCamelCase,
} from "./game-conversor-utils";
import { expandedGame } from "../catalog/fixtures/expanded-game";

describe("single-game normalization", () => {
    it("converts dates and keys at every level without mutating the fixture", () => {
        const source = expandedGame();
        const snapshot = structuredClone(source);
        const game = normalizeIgdbGame(source);
        expect(game.firstReleaseDate).toEqual(new Date(1000));
        expect(game.updatedAt).toEqual(new Date(2000));
        expect(game.involvedCompanies?.[0]?.company?.changeDate).toEqual(
            new Date(1000),
        );
        expect(game.gameEngines?.[0]?.companies?.[0]?.startDate).toEqual(
            new Date(1000),
        );
        expect(game.cover?.imageId).toBe("image-token");
        expect(game.localizations).toBe(game.gameLocalizations);
        game.name = "changed";
        expect(source).toEqual(snapshot);
        expect(normalizeIgdbResults([source])).toEqual([
            normalizeIgdbGame(source),
        ]);
    });
    it("preserves null, empty arrays and primitive values, and clears empty objects", () => {
        expect(
            normalizeIgdbGame({
                id: 1,
                cover: {},
                artworks: [],
                null_value: null,
                raw_ids: [1, 2],
                _private_key: 3,
                invalid_date: Infinity,
                created_at: Infinity,
            }),
        ).toMatchObject({
            id: 1,
            cover: undefined,
            artworks: [],
            nullValue: null,
            rawIds: [1, 2],
            _private_key: 3,
            createdAt: undefined,
        });
        expect(snakeCaseToCamelCase("first-release_date")).toBe(
            "firstReleaseDate",
        );
    });
    it("keeps the exported date helper immutable", () => {
        const original = normalizeIgdbGame({ id: 1, name: "Fixture" });
        original.createdAt = 1 as unknown as Date;
        expect(parseGameDates(original).createdAt).toEqual(new Date(1000));
        expect(original.createdAt).toBe(1);
    });
});
