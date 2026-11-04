import { BadRequestException } from "@nestjs/common";
import { DailyGameData, DailyNamed, evaluateDaily } from "./daily-evaluator";
import {
    DailyGuessResult,
    DailyMatch,
    DailyMode,
    DailyStatus,
} from "./daily.constants";

const n = (id: number, name = `n${id}`): DailyNamed => ({ id, name });

const game = (
    id: number,
    overrides: Partial<DailyGameData> = {},
): DailyGameData => ({
    id,
    name: `Game ${id}`,
    slug: `game-${id}`,
    year: 2000,
    coverUrl: null,
    franchises: [],
    genres: [],
    platforms: [],
    themes: [],
    gameModes: [],
    perspectives: [],
    gameEngines: [],
    companies: [],
    ...overrides,
});

const answer = game(1, {
    year: 2010,
    coverUrl: "https://cover",
    franchises: [n(100, "Zelda")],
    genres: [n(10, "RPG"), n(11, "Adventure")],
    platforms: [n(20, "Switch")],
    companies: [n(30, "Nintendo")],
});

const keywords = Array.from({ length: 12 }, (_, i) => `k${i}`);
const wrong = (count: number, from = 2) =>
    Array.from({ length: count }, (_, i) => game(from + i));

const play = (
    mode: DailyMode,
    guesses: (DailyGameData | null)[],
    hintAt: number | null = null,
) => evaluateDaily({ mode, answer, guesses, hintAt, keywords });

describe("evaluateDaily", () => {
    it("wins on a correct last guess and reveals the answer", () => {
        const result = play(DailyMode.COVER, [game(2), answer]);
        expect(result.status).toBe(DailyStatus.WON);
        expect(result.attempts).toBe(2);
        expect(result.feedback.map((f) => f.result)).toEqual([
            DailyGuessResult.WRONG,
            DailyGuessResult.CORRECT,
        ]);
        expect(result.answer).toEqual({
            id: 1,
            name: "Game 1",
            slug: "game-1",
            coverUrl: "https://cover",
            year: 2010,
        });
    });

    it("loses when attempts run out", () => {
        const result = play(DailyMode.COVER, wrong(6));
        expect(result.status).toBe(DailyStatus.LOST);
        expect(result.answer?.id).toBe(1);
    });

    it("never exposes the answer while in progress", () => {
        const result = play(DailyMode.COVER, [game(2)]);
        expect(result.status).toBe(DailyStatus.IN_PROGRESS);
        expect(result.answer).toBeUndefined();
        expect(JSON.stringify(result)).not.toContain("game-1");
    });

    it("counts a skip as an attempt", () => {
        const result = play(DailyMode.COVER, [null]);
        expect(result.attempts).toBe(1);
        expect(result.feedback[0]).toEqual({
            gameId: null,
            name: null,
            result: DailyGuessResult.SKIPPED,
            commonGenres: [],
            commonPlatforms: [],
        });
    });

    it("flags a shared franchise and lists common genres and platforms", () => {
        const guess = game(2, {
            franchises: [n(100, "Zelda")],
            genres: [n(10, "RPG"), n(12, "Puzzle")],
            platforms: [n(20, "Switch"), n(21, "PC")],
        });
        const [feedback] = play(DailyMode.COVER, [guess]).feedback;
        expect(feedback.result).toBe(DailyGuessResult.FRANCHISE);
        expect(feedback.commonGenres).toEqual(["RPG"]);
        expect(feedback.commonPlatforms).toEqual(["Switch"]);
        expect(feedback.columns).toBeUndefined();
    });

    it("sends only genre, theme, platform and franchise traits outside specs mode", () => {
        const guess = game(2, {
            franchises: [n(100, "Zelda"), n(101, "Mario")],
            genres: [n(10, "RPG"), n(11, "Adventure")],
            platforms: [n(21, "PC")],
            gameEngines: [n(40, "Unreal")],
        });
        const [feedback, skip] = play(DailyMode.COVER, [guess, null]).feedback;
        expect(feedback.traits).toEqual({
            genres: { match: DailyMatch.MATCH, values: ["RPG", "Adventure"] },
            themes: { match: DailyMatch.MATCH, values: [] },
            platforms: { match: DailyMatch.NONE, values: ["PC"] },
            franchise: { match: DailyMatch.PARTIAL },
        });
        expect(skip.traits).toBeUndefined();
        for (const mode of [DailyMode.ARTWORK, DailyMode.KEYWORDS])
            expect(
                Object.keys(play(mode, [guess]).feedback[0].traits!),
            ).toEqual(["genres", "themes", "platforms", "franchise"]);
        expect(
            play(DailyMode.SPECS, [guess]).feedback[0].traits,
        ).toBeUndefined();
    });

    it("never matches the franchise of two games without one", () => {
        const noFranchise = { ...answer, franchises: [] };
        const [feedback] = evaluateDaily({
            mode: DailyMode.COVER,
            answer: noFranchise,
            guesses: [game(2)],
            hintAt: null,
            keywords,
        }).feedback;
        expect(feedback.result).toBe(DailyGuessResult.WRONG);
        expect(feedback.traits?.franchise.match).toBe(DailyMatch.NONE);
        expect(
            evaluateDaily({
                mode: DailyMode.SPECS,
                answer: noFranchise,
                guesses: [game(2)],
                hintAt: null,
                keywords,
            }).feedback[0].columns?.franchise.match,
        ).toBe(DailyMatch.NONE);
    });

    it("unlocks image levels with attempts, capped at 5", () => {
        expect(play(DailyMode.COVER, []).hints.imageLevel).toBe(0);
        expect(play(DailyMode.ARTWORK, wrong(3)).hints.imageLevel).toBe(3);
        expect(play(DailyMode.COVER, wrong(6)).hints.imageLevel).toBe(5);
    });

    it("reveals 3 + attempts keywords and the cover on the last attempt", () => {
        expect(play(DailyMode.KEYWORDS, []).hints).toEqual({
            imageLevel: null,
            keywords: ["k0", "k1", "k2"],
        });
        expect(play(DailyMode.KEYWORDS, wrong(2)).hints.keywords).toHaveLength(
            5,
        );
        expect(play(DailyMode.KEYWORDS, wrong(4)).hints.imageLevel).toBeNull();
        expect(play(DailyMode.KEYWORDS, wrong(5)).hints.imageLevel).toBe(0);
    });

    describe("specs columns", () => {
        const columnsFor = (guess: DailyGameData) =>
            play(DailyMode.SPECS, [guess]).feedback[0].columns!;

        it("matches equal sets, including two empty ones", () => {
            const columns = columnsFor(
                game(2, {
                    genres: [n(11, "Adventure"), n(10, "RPG")],
                    franchises: [n(100, "Zelda")],
                }),
            );
            expect(columns.genres).toEqual({
                match: DailyMatch.MATCH,
                values: ["Adventure", "RPG"],
            });
            expect(columns.themes).toEqual({
                match: DailyMatch.MATCH,
                values: [],
            });
            expect(columns.franchise).toEqual({ match: DailyMatch.MATCH });
        });

        it("is partial on overlap and none otherwise, with the guess's own values", () => {
            const columns = columnsFor(
                game(2, {
                    genres: [n(10, "RPG"), n(12, "Puzzle")],
                    platforms: [n(21, "PC")],
                }),
            );
            expect(columns.genres).toEqual({
                match: DailyMatch.PARTIAL,
                values: ["RPG", "Puzzle"],
            });
            expect(columns.platforms).toEqual({
                match: DailyMatch.NONE,
                values: ["PC"],
            });
            expect(columns.companies.match).toBe(DailyMatch.NONE);
            expect(columns.franchise.match).toBe(DailyMatch.NONE);
        });

        it("points the year arrow at the answer and is partial within 5 years", () => {
            expect(columnsFor(game(2, { year: 2010 })).releaseYear).toEqual({
                match: DailyMatch.MATCH,
                value: 2010,
                direction: null,
            });
            expect(columnsFor(game(2, { year: 2006 })).releaseYear).toEqual({
                match: DailyMatch.PARTIAL,
                value: 2006,
                direction: "higher",
            });
            expect(columnsFor(game(2, { year: 2015 })).releaseYear).toEqual({
                match: DailyMatch.PARTIAL,
                value: 2015,
                direction: "lower",
            });
            expect(columnsFor(game(2, { year: 2016 })).releaseYear).toEqual({
                match: DailyMatch.NONE,
                value: 2016,
                direction: "lower",
            });
            expect(columnsFor(game(2, { year: null })).releaseYear).toEqual({
                match: DailyMatch.NONE,
                value: null,
                direction: null,
            });
        });

        it("narrows the year range with each guess", () => {
            expect(
                play(DailyMode.SPECS, [game(2, { year: 1990 })]).hints.yearRange
                    ?.min,
            ).toBe(1991);
            expect(
                play(DailyMode.SPECS, [
                    game(2, { year: 1990 }),
                    game(3, { year: 2014 }),
                ]).hints.yearRange,
            ).toEqual({
                min: 2009,
                max: 2013,
            });
            expect(
                play(DailyMode.SPECS, [game(2, { year: 2008 })]).hints
                    .yearRange,
            ).toEqual({ min: 2009, max: 2013 });
            expect(
                play(DailyMode.SPECS, [game(2, { year: 2010 })]).hints
                    .yearRange,
            ).toEqual({ min: 2010, max: 2010 });
        });
    });

    describe("specs hint", () => {
        it("is available after 5 guesses and costs an attempt", () => {
            expect(play(DailyMode.SPECS, wrong(4)).hintAvailable).toBe(false);
            expect(play(DailyMode.SPECS, wrong(5)).hintAvailable).toBe(true);
            const used = play(DailyMode.SPECS, wrong(5), 5);
            expect(used.attempts).toBe(6);
            expect(used.hintAvailable).toBe(false);
            expect(play(DailyMode.SPECS, wrong(9), 7).status).toBe(
                DailyStatus.LOST,
            );
        });

        it("reveals the answer's values for the first column no guess matched", () => {
            expect(play(DailyMode.SPECS, wrong(5), 5).hints.reveal).toEqual({
                column: "releaseYear",
                values: ["2010"],
            });
            const guesses = [...wrong(4), game(9, { year: 2010 })];
            expect(play(DailyMode.SPECS, guesses, 5).hints.reveal).toEqual({
                column: "genres",
                values: ["RPG", "Adventure"],
            });
            expect(
                play(DailyMode.SPECS, wrong(5)).hints.reveal,
            ).toBeUndefined();
        });

        it("keeps the reveal when a later guess matches that column", () => {
            const later = [...wrong(5), game(9, { year: 2010 })];
            expect(play(DailyMode.SPECS, later, 5).hints.reveal).toEqual({
                column: "releaseYear",
                values: ["2010"],
            });
            expect(play(DailyMode.SPECS, later, 6).hints.reveal?.column).toBe(
                "genres",
            );
        });

        it("rejects an invalid hint position", () => {
            expect(() => play(DailyMode.COVER, wrong(5), 5)).toThrow(
                BadRequestException,
            );
            expect(() => play(DailyMode.SPECS, wrong(5), 4)).toThrow(
                BadRequestException,
            );
            expect(() => play(DailyMode.SPECS, wrong(5), 6)).toThrow(
                BadRequestException,
            );
            expect(() => play(DailyMode.SPECS, wrong(6), 5.5)).toThrow(
                BadRequestException,
            );
        });
    });

    it("rejects guesses after the correct one and too many attempts", () => {
        expect(() => play(DailyMode.COVER, [answer, game(2)])).toThrow(
            BadRequestException,
        );
        expect(() => play(DailyMode.COVER, wrong(7))).toThrow(
            BadRequestException,
        );
        expect(() => play(DailyMode.SPECS, wrong(10), 5)).toThrow(
            BadRequestException,
        );
    });
});
