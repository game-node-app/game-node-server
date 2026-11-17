import { ApiProperty } from "@nestjs/swagger";
import { PaginationInfo } from "../../utils/pagination/pagination-response.dto";
import { ProfileAvatar } from "../../profile/entities/profile-avatar.entity";
import {
    DailyGuessResult,
    DailyMatch,
    DailyMode,
    DailyStatus,
} from "../daily.constants";
import { DailyRankingPeriod, DailyRankingScope } from "../daily-ranking.utils";

export class DailyPuzzleResultSummaryDto {
    status: DailyStatus;
    attempts: number;
}

export class DailyWeeklyDto {
    id: number;
    number: number;
    mode: DailyMode;
    maxAttempts: number;
    /** ISO instant the week ends (next Monday 00:00 in São Paulo). */
    endsAt: string;
    /** Only for signed-in users who started this challenge. */
    result?: DailyPuzzleResultSummaryDto;
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
    /** This week's challenge, or null when none exists. */
    weekly: DailyWeeklyDto | null;
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

export class DailyGuessFeedbackDto {
    /** `null` for a skip. */
    gameId: number | null;
    name: string | null;
    result: DailyGuessResult;
    commonGenres: string[];
    commonPlatforms: string[];
    /** Specs mode only. */
    columns?: DailySpecsColumnsDto;
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

/** The play state a daily puzzle and a practice round share. */
export class DailyPlayStateDto {
    mode: DailyMode;
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
}

export class DailyPlayResponseDto extends DailyPlayStateDto {
    puzzleId: number;
    number: number;
    date: string;
    /** Only once the puzzle is finished. */
    community?: DailyCommunityDto;
    /** Signed-in daily finishes only; absent for guests, unfinished plays and weekly puzzles. */
    ranking?: DailyRankingSummaryDto;
}

export class DailyPracticePlayResponseDto extends DailyPlayStateDto {
    /** The round id: the capability for a guest round. */
    roundId: string;
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

export class DailyRankingRowDto {
    /** Consecutive position in the filtered list, starting at 1. */
    position: number;
    /** Positions moved since the same list without today's puzzles; "new" on a first counted result; null for `today`. */
    @ApiProperty({
        oneOf: [{ type: "integer" }, { type: "string" }],
        nullable: true,
    })
    positionChange: number | "new" | null;
    userId: string;
    username: string;
    @ApiProperty({ type: () => ProfileAvatar, nullable: true })
    avatar: ProfileAvatar | null;
    /** Entitled supporter who has not hidden the badge. */
    supporterBadge: boolean;
    /** Points with one decimal place. */
    points: number;
    /** Percentage of counted results won, 0 to 100 with one decimal place. */
    winRate: number;
    /** Overall rows only: points per mode with one decimal place. */
    modePoints?: Record<DailyMode, number>;
    /** Overall rows only. */
    currentStreak?: number;
    /** Mode rows only. */
    wins?: number;
    /** Mode rows only; null without a counted win. */
    averageAttempts?: number | null;
    /** Mode rows only, over all time. */
    bestStreak?: number;
}

export class DailyRankingResponseDto {
    period: DailyRankingPeriod;
    /** null in the overall ranking. */
    mode: DailyMode | null;
    scope: DailyRankingScope;
    /** ISO instant the period ends; null for `all`. */
    endsAt: string | null;
    /** Ranked players in the period, filter and scope. */
    totalPlayers: number;
    /** The requester's row, or null for guests and players without a counted result. */
    viewer: DailyRankingRowDto | null;
    /** Points needed to reach position 100 when the viewer is outside it. */
    @ApiProperty({ nullable: true })
    pointsToTop100: number | null;
    data: DailyRankingRowDto[];
    pagination: PaginationInfo;
}

export class DailyRankingSummaryDto {
    /** Whether this result counts for the ranking. */
    counted: boolean;
    /** Points this result earned, with one decimal place. */
    pointsEarned: number;
    /** Completion bonus earned by this result, with one decimal place. */
    bonusEarned: number;
    /** The viewer's week points including this result. */
    weekPoints: number;
    @ApiProperty({ nullable: true })
    weekPosition: number | null;
    @ApiProperty({ nullable: true })
    previousWeekPosition: number | null;
    @ApiProperty({ nullable: true })
    pointsToTop100: number | null;
}

export class DailyWeeklyRankingRowDto {
    userId: string;
    username: string;
    @ApiProperty({ type: () => ProfileAvatar, nullable: true })
    avatar: ProfileAvatar | null;
    supporterBadge: boolean;
    status: DailyStatus;
    attempts: number;
    finishedAt: Date | null;
}

export class DailyWeeklyRankingResponseDto {
    weekly: DailyWeeklyDto | null;
    data: DailyWeeklyRankingRowDto[];
}
