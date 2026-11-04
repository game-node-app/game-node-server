import { ApiProperty, PickType } from "@nestjs/swagger";
import { PaginationInfo } from "../../utils/pagination/pagination-response.dto";
import {
    DailyGuessResult,
    DailyMatch,
    DailyMode,
    DailyStatus,
} from "../daily.constants";

export class DailyPuzzleResultSummaryDto {
    status: DailyStatus;
    attempts: number;
}

export class DailyPuzzleDto {
    id: number;
    mode: DailyMode;
    number: number;
    date: string;
    maxAttempts: number;
    /** Only for signed-in users who started this puzzle. */
    result?: DailyPuzzleResultSummaryDto;
}

export class DailyTodayResponseDto {
    date: string;
    /** ISO instant of the next puzzle reset (midnight in São Paulo). */
    nextResetAt: string;
    puzzles: DailyPuzzleDto[];
}

export class DailyArchiveResponseDto {
    data: DailyPuzzleDto[];
    pagination: PaginationInfo;
}

export class DailySetColumnDto {
    match: DailyMatch;
    /** The guess's own values. */
    values: string[];
}

export class DailyFranchiseColumnDto {
    match: DailyMatch;
}

export class DailyYearColumnDto {
    match: DailyMatch;
    value: number | null;
    /** Whether the answer was released after ("higher") or before ("lower") the guess. */
    @ApiProperty({ enum: ["higher", "lower"], nullable: true })
    direction: "higher" | "lower" | null;
}

export class DailySpecsColumnsDto {
    platforms: DailySetColumnDto;
    genres: DailySetColumnDto;
    themes: DailySetColumnDto;
    gameModes: DailySetColumnDto;
    gameEngines: DailySetColumnDto;
    companies: DailySetColumnDto;
    perspectives: DailySetColumnDto;
    franchise: DailyFranchiseColumnDto;
    releaseYear: DailyYearColumnDto;
}

export type DailyRevealColumn = keyof DailySpecsColumnsDto;

/** Hint reveal priority: the first column no guess matched is revealed. */
export const DAILY_REVEAL_ORDER: DailyRevealColumn[] = [
    "releaseYear",
    "genres",
    "platforms",
    "companies",
    "franchise",
    "themes",
    "gameModes",
    "perspectives",
    "gameEngines",
];

export class DailyGuessTraitsDto extends PickType(DailySpecsColumnsDto, [
    "genres",
    "themes",
    "platforms",
    "franchise",
] as const) {}

export class DailyGuessFeedbackDto {
    /** `null` for a skip. */
    gameId: number | null;
    name: string | null;
    result: DailyGuessResult;
    commonGenres: string[];
    commonPlatforms: string[];
    /** Specs mode only. */
    columns?: DailySpecsColumnsDto;
    /** Cover, artwork and keywords modes only; never on a skip. */
    traits?: DailyGuessTraitsDto;
}

export class DailyYearRangeDto {
    min: number;
    max: number;
}

export class DailyRevealDto {
    @ApiProperty({ enum: DAILY_REVEAL_ORDER })
    column: DailyRevealColumn;
    /** The answer's values for that column. */
    values: string[];
}

export class DailyHintsDto {
    /** Signed tokens for GET /daily/images/:token, from the most pixelated level up. */
    imageTokens: string[];
    keywords: string[];
    yearRange?: DailyYearRangeDto;
    reveal?: DailyRevealDto;
}

export class DailyAnswerDto {
    id: number;
    name: string;
    slug: string;
    coverUrl: string | null;
    year: number | null;
}

export class DailyCommunityDto {
    /** Players who solved this puzzle. */
    players: number;
    averageAttempts: number;
}

export class DailyPlayResponseDto {
    puzzleId: number;
    mode: DailyMode;
    number: number;
    date: string;
    maxAttempts: number;
    attempts: number;
    status: DailyStatus;
    feedback: DailyGuessFeedbackDto[];
    hints: DailyHintsDto;
    hintAvailable: boolean;
    /** Guesses made before the specs hint was used; `null` if it wasn't. */
    hintAt: number | null;
    /** Only once the puzzle is finished. */
    answer?: DailyAnswerDto;
    /** Also sent while the puzzle is in progress. */
    community?: DailyCommunityDto;
}

export class DailyResultDto {
    puzzleId: number;
    mode: DailyMode;
    number: number;
    date: string;
    status: DailyStatus;
    attempts: number;
    finishedAt: Date | null;
}

export class DailyResultsResponseDto {
    data: DailyResultDto[];
}

export class DailyImportResultsResponseDto {
    imported: number;
}
