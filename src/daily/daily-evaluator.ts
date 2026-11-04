import { BadRequestException } from "@nestjs/common";
import {
    DAILY_MAX_ATTEMPTS,
    DailyGuessResult,
    DailyMatch,
    DailyMode,
    DailyStatus,
} from "./daily.constants";
import {
    DAILY_REVEAL_ORDER,
    DailyAnswerDto,
    DailyGuessFeedbackDto,
    DailyHintsDto,
    DailySetColumnDto,
    DailySpecsColumnsDto,
    DailyYearColumnDto,
} from "./dto/daily-response.dto";

export interface DailyNamed {
    id: number;
    name: string;
}

/** A game reduced to what the evaluator compares. */
export interface DailyGameData {
    id: number;
    name: string;
    slug: string;
    year: number | null;
    coverUrl: string | null;
    franchises: DailyNamed[];
    genres: DailyNamed[];
    platforms: DailyNamed[];
    themes: DailyNamed[];
    gameModes: DailyNamed[];
    perspectives: DailyNamed[];
    gameEngines: DailyNamed[];
    /** Developers and publishers. */
    companies: DailyNamed[];
}

export interface DailyEvaluationInput {
    mode: DailyMode;
    answer: DailyGameData;
    /** `null` is a skip. */
    guesses: (DailyGameData | null)[];
    /** Specs only: how many guesses existed when the hint was used, `null` if it wasn't. */
    hintAt: number | null;
    /** The answer's keyword names, in reveal order. */
    keywords: string[];
}

export interface DailyEvaluation {
    attempts: number;
    status: DailyStatus;
    feedback: DailyGuessFeedbackDto[];
    hints: Omit<DailyHintsDto, "imageTokens"> & {
        /** Levels 0..imageLevel of the mode's image are unlocked; `null` for none. */
        imageLevel: number | null;
    };
    hintAvailable: boolean;
    answer?: DailyAnswerDto;
}

const SET_COLUMNS = [
    "platforms",
    "genres",
    "themes",
    "gameModes",
    "gameEngines",
    "companies",
    "perspectives",
] as const;

const DAILY_MIN_YEAR = 1950;
const HINT_MIN_GUESSES = 5;

const common = (guess: DailyNamed[], answer: DailyNamed[]) => {
    const answerIds = new Set(answer.map((item) => item.id));
    return guess
        .filter((item) => answerIds.has(item.id))
        .map((item) => item.name);
};

// Ids are unique per list, so equal sizes plus full overlap means equal sets (two empty sets included).
const setMatch = (guess: DailyNamed[], answer: DailyNamed[]): DailyMatch => {
    const shared = common(guess, answer).length;
    if (shared === guess.length && shared === answer.length)
        return DailyMatch.MATCH;
    return shared > 0 ? DailyMatch.PARTIAL : DailyMatch.NONE;
};

const yearColumn = (
    guess: number | null,
    answer: number | null,
): DailyYearColumnDto => {
    if (guess === null || answer === null)
        return { match: DailyMatch.NONE, value: guess, direction: null };
    const diff = answer - guess;
    return {
        match:
            diff === 0
                ? DailyMatch.MATCH
                : Math.abs(diff) <= 5
                  ? DailyMatch.PARTIAL
                  : DailyMatch.NONE,
        value: guess,
        direction: diff > 0 ? "higher" : diff < 0 ? "lower" : null,
    };
};

const specsColumns = (
    guess: DailyGameData,
    answer: DailyGameData,
): DailySpecsColumnsDto => {
    const sets = Object.fromEntries(
        SET_COLUMNS.map((column): [string, DailySetColumnDto] => [
            column,
            {
                match: setMatch(guess[column], answer[column]),
                values: guess[column].map((item) => item.name),
            },
        ]),
    ) as Record<(typeof SET_COLUMNS)[number], DailySetColumnDto>;
    return {
        ...sets,
        franchise: { match: setMatch(guess.franchises, answer.franchises) },
        releaseYear: yearColumn(guess.year, answer.year),
    };
};

const feedbackFor = (
    mode: DailyMode,
    guess: DailyGameData | null,
    answer: DailyGameData,
): DailyGuessFeedbackDto => {
    if (!guess)
        return {
            gameId: null,
            name: null,
            result: DailyGuessResult.SKIPPED,
            commonGenres: [],
            commonPlatforms: [],
        };
    const result =
        guess.id === answer.id
            ? DailyGuessResult.CORRECT
            : common(guess.franchises, answer.franchises).length
              ? DailyGuessResult.FRANCHISE
              : DailyGuessResult.WRONG;
    return {
        gameId: guess.id,
        name: guess.name,
        result,
        commonGenres: common(guess.genres, answer.genres),
        commonPlatforms: common(guess.platforms, answer.platforms),
        columns:
            mode === DailyMode.SPECS ? specsColumns(guess, answer) : undefined,
    };
};

const yearRange = (guesses: (DailyGameData | null)[], answer: number) => {
    let min = Math.min(DAILY_MIN_YEAR, answer);
    let max = Math.max(new Date().getUTCFullYear(), answer);
    for (const guess of guesses) {
        if (guess?.year == null) continue;
        const diff = answer - guess.year;
        if (diff === 0) return { min: answer, max: answer };
        if (diff > 0) {
            min = Math.max(min, guess.year + 1);
            if (diff <= 5) max = Math.min(max, guess.year + 5);
        } else {
            max = Math.min(max, guess.year - 1);
            if (diff >= -5) min = Math.max(min, guess.year - 5);
        }
    }
    return { min, max };
};

const revealValues = (
    column: (typeof DAILY_REVEAL_ORDER)[number],
    answer: DailyGameData,
) => {
    if (column === "releaseYear")
        return answer.year === null ? [] : [String(answer.year)];
    const items = column === "franchise" ? answer.franchises : answer[column];
    return items.map((item) => item.name);
};

/**
 * Evaluates a whole play from scratch, so a stored result and a guest's local state give the same answer.
 * Throws a 400 for a state no valid play can reach.
 */
export function evaluateDaily(input: DailyEvaluationInput): DailyEvaluation {
    const { mode, answer, guesses, hintAt, keywords } = input;
    const max = DAILY_MAX_ATTEMPTS[mode];
    const attempts = guesses.length + (hintAt !== null ? 1 : 0);

    if (
        hintAt !== null &&
        (mode !== DailyMode.SPECS ||
            !Number.isInteger(hintAt) ||
            hintAt < HINT_MIN_GUESSES ||
            hintAt > guesses.length)
    )
        throw new BadRequestException(
            `The hint is only available in specs mode after ${HINT_MIN_GUESSES} guesses`,
        );
    if (attempts > max)
        throw new BadRequestException(`At most ${max} attempts are allowed`);
    const correctIndex = guesses.findIndex((guess) => guess?.id === answer.id);
    if (correctIndex !== -1 && correctIndex !== guesses.length - 1)
        throw new BadRequestException(
            "No guesses are allowed after the correct one",
        );

    const status =
        correctIndex !== -1
            ? DailyStatus.WON
            : attempts >= max
              ? DailyStatus.LOST
              : DailyStatus.IN_PROGRESS;
    const feedback = guesses.map((guess) => feedbackFor(mode, guess, answer));

    let imageLevel: number | null = null;
    if (mode === DailyMode.COVER || mode === DailyMode.ARTWORK)
        imageLevel = Math.min(attempts, 5);
    else if (mode === DailyMode.KEYWORDS && attempts >= max - 1) imageLevel = 0;

    const hints: DailyEvaluation["hints"] = {
        imageLevel,
        keywords:
            mode === DailyMode.KEYWORDS ? keywords.slice(0, 3 + attempts) : [],
    };
    if (mode === DailyMode.SPECS && answer.year !== null)
        hints.yearRange = yearRange(guesses, answer.year);
    if (mode === DailyMode.SPECS && hintAt !== null) {
        // Only the guesses made before the hint, so later matches can't move the reveal.
        const column = DAILY_REVEAL_ORDER.find(
            (column) =>
                !feedback
                    .slice(0, hintAt)
                    .some(
                        (item) =>
                            item.columns?.[column].match === DailyMatch.MATCH,
                    ),
        );
        if (column)
            hints.reveal = { column, values: revealValues(column, answer) };
    }

    return {
        attempts,
        status,
        feedback,
        hints,
        hintAvailable:
            mode === DailyMode.SPECS &&
            status === DailyStatus.IN_PROGRESS &&
            hintAt === null &&
            guesses.length >= HINT_MIN_GUESSES,
        answer:
            status === DailyStatus.IN_PROGRESS
                ? undefined
                : {
                      id: answer.id,
                      name: answer.name,
                      slug: answer.slug,
                      coverUrl: answer.coverUrl,
                      year: answer.year,
                  },
    };
}
