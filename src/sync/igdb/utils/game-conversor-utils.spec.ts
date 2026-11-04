import {
    normalizeIgdbGame,
    parseGameDates,
    snakeCaseToCamelCase,
} from "./game-conversor-utils";
import { expandedGame } from "../catalog/fixtures/expanded-game";
import { CatalogDataError } from "../catalog/igdb-catalog.client";

describe("single-game normalization", () => {
    it.each([
        {},
        1,
        "videos",
        [null],
        [1],
        [[]],
        [{}],
        [{ id: 0 }],
        [{ id: 1.5 }],
        [{ id: Number.MAX_SAFE_INTEGER + 1 }],
        [{ id: 1, name: {} }],
        [{ id: 1, video_id: 1 }],
        [{ id: 1, checksum: false }],
        [{ id: 1, game: null }],
        [{ id: 1, game: 2 }],
    ])("rejects malformed videos %j", (videos) => {
        expect(() => normalizeIgdbGame({ id: 1, videos })).toThrow(
            CatalogDataError,
        );
        expect(() => normalizeIgdbGame({ id: 1, videos })).toThrow(
            "Game 1: invalid videos",
        );
    });
    it("accepts absent, null, empty and minimally populated videos", () => {
        expect(normalizeIgdbGame({ id: 1 }).videos).toBeUndefined();
        expect(normalizeIgdbGame({ id: 1, videos: null }).videos).toBeNull();
        expect(normalizeIgdbGame({ id: 1, videos: [] }).videos).toEqual([]);
        expect(
            normalizeIgdbGame({ id: 1, videos: [{ id: 2, game: 1 }] })
                .videos?.[0],
        ).toMatchObject({ id: 2 });
    });
    it("derives encoded URLs and clears missing or empty identifiers", () => {
        const videos = normalizeIgdbGame({
            id: 1,
            videos: [
                { id: 2, video_id: "abc123_Xy-Z" },
                { id: 3, video_id: "a&b?#" },
                { id: 4 },
                { id: 5, video_id: "" },
            ],
        }).videos!;
        expect(videos[0]).toMatchObject({
            videoId: "abc123_Xy-Z",
            url: "https://www.youtube.com/watch?v=abc123_Xy-Z",
        });
        expect(videos[1]).toMatchObject({
            videoId: "a&b?#",
            url: "https://www.youtube.com/watch?v=a%26b%3F%23",
        });
        expect(videos[2]).toMatchObject({
            name: null,
            checksum: null,
            videoId: null,
            url: null,
        });
        expect(videos[3]).toMatchObject({ videoId: "", url: null });
    });
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
