import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { minutes } from "@nestjs/throttler";
import dayjs from "dayjs";
import { GameRepositoryService } from "../../game/game-repository/game-repository.service";
import { PlaytimeHistoryService } from "../../playtime/playtime-history.service";
import { PlaytimeService } from "../../playtime/playtime.service";
import { Period, PeriodToMinusDays } from "../../utils/period";
import { Cacheable } from "../../utils/cacheable";
import {
    ProfileMetricsSummaryGameDto,
    ProfileMetricsSummaryNamedTotalDto,
    ProfileMetricsSummaryPeriod,
    ProfileMetricsSummaryResponseDto,
    ProfileMetricsSummaryWindowDto,
} from "./dto/profile-metrics-summary.dto";
import { ProfileMetricsReportService } from "./profile-metrics-report.service";

const SUPPORTED_PERIODS: Period[] = [Period.WEEK, Period.MONTH, Period.YEAR];
const TOP_GAMES_LIMIT = 5;

type PlaytimeRow = {
    gameId: number;
    platformId: number;
    totalPlaytimeInPeriodSeconds: number;
};

type HistoryRow = PlaytimeRow & { source?: string };

type CumulativeRow = {
    gameId: number | string;
    platformId: number | string;
    source: string;
    totalPlaytimeSeconds: number | string;
    recentPlaytimeSeconds: number | string;
};

/**
 * Period summary behind the recap share card: real playtime deltas from the
 * playtime history, with the same figures for the previous window so clients
 * can show the change.
 */
@Injectable()
export class ProfileMetricsSummaryService {
    constructor(
        private readonly playtimeHistoryService: PlaytimeHistoryService,
        private readonly gameRepositoryService: GameRepositoryService,
        private readonly profileMetricsReportService: ProfileMetricsReportService,
        private readonly playtimeService: PlaytimeService,
    ) {}

    @Cacheable(ProfileMetricsSummaryService.name, minutes(10))
    public async generateSummary(
        userId: string,
        period: ProfileMetricsSummaryPeriod,
    ): Promise<ProfileMetricsSummaryResponseDto> {
        if (!SUPPORTED_PERIODS.includes(period)) {
            throw new HttpException("Invalid period", HttpStatus.BAD_REQUEST);
        }

        const now = dayjs();
        const windowStart = now.subtract(PeriodToMinusDays[period], "day");
        const previousStart = windowStart.subtract(
            PeriodToMinusDays[period],
            "day",
        );

        const [historyRows, previousRows, counts, playedRows] =
            await Promise.all([
                this.playtimeHistoryService.getTotalPlaytimeForPeriod({
                    userId,
                    startDate: windowStart.toDate(),
                    endDate: now.toDate(),
                }),
                this.playtimeHistoryService.getTotalPlaytimeForPeriod({
                    userId,
                    startDate: previousStart.toDate(),
                    endDate: windowStart.toDate(),
                }),
                this.profileMetricsReportService.getActivityCountsSince(
                    userId,
                    windowStart,
                ),
                this.playtimeService.findPlayedSince(
                    userId,
                    windowStart.toDate(),
                ),
            ]);
        const currentRows = withCumulativeFallback(
            historyRows,
            playedRows,
            period,
        );

        const secondsByGame = sumBy(currentRows, (row) => row.gameId);
        const topGames = this.buildTopGames(secondsByGame);

        const [topGenre, topPlatform] = await Promise.all([
            this.findTopGenre(secondsByGame),
            this.findTopPlatform(currentRows),
        ]);

        return {
            period,
            current: toWindow(currentRows),
            previous: toWindow(previousRows),
            topGames,
            topGenre,
            topPlatform,
            playedInPeriod: counts.played,
            finishedInPeriod: counts.finished,
            reviewedInPeriod: counts.reviewed,
        };
    }

    private buildTopGames(
        secondsByGame: Map<number, number>,
    ): ProfileMetricsSummaryGameDto[] {
        return topEntries(secondsByGame, TOP_GAMES_LIMIT).map(
            ([gameId, totalPlaytimeSeconds]) => ({
                gameId,
                totalPlaytimeSeconds,
            }),
        );
    }

    private async findTopGenre(
        secondsByGame: Map<number, number>,
    ): Promise<ProfileMetricsSummaryNamedTotalDto | null> {
        const playedGameIds = [...secondsByGame.entries()]
            .filter(([, seconds]) => seconds > 0)
            .map(([gameId]) => gameId);
        if (playedGameIds.length === 0) return null;

        // Games missing from the catalog (or without genres) simply contribute nothing.
        const gameGenres =
            await this.gameRepositoryService.findGameGenresByIds(playedGameIds);

        const secondsByGenre = new Map<number, number>();
        const genreNames = new Map<number, string>();
        for (const { gameId, genreId, genreName } of gameGenres) {
            const seconds = secondsByGame.get(gameId) ?? 0;
            genreNames.set(genreId, genreName ?? "");
            secondsByGenre.set(
                genreId,
                (secondsByGenre.get(genreId) ?? 0) + seconds,
            );
        }

        const [top] = topEntries(secondsByGenre, 1);
        if (!top) return null;

        return {
            id: top[0],
            name: genreNames.get(top[0]) ?? "",
            totalPlaytimeSeconds: top[1],
        };
    }

    private async findTopPlatform(
        rows: PlaytimeRow[],
    ): Promise<ProfileMetricsSummaryNamedTotalDto | null> {
        const secondsByPlatform = sumBy(rows, (row) => row.platformId);
        const [top] = topEntries(secondsByPlatform, 1);
        if (!top) return null;

        const platforms =
            await this.gameRepositoryService.getGamePlatformsMap("id");
        const platform = platforms.get(top[0]);

        return {
            id: top[0],
            name: platform?.name ?? "",
            totalPlaytimeSeconds: top[1],
        };
    }
}

/**
 * The playtime history only records growth between two syncs, so playtime
 * imported before the history existed (the first Steam or Switch sync) counts
 * as zero. The profile shows the cumulative rows instead, so games played in
 * the window but missing or short in the history are topped up from them:
 * the cumulative total for the year, the recent playtime for a week or month.
 */
function withCumulativeFallback(
    history: HistoryRow[],
    played: CumulativeRow[],
    period: ProfileMetricsSummaryPeriod,
): PlaytimeRow[] {
    const keyOf = (row: {
        gameId: number | string;
        platformId: number | string;
        source?: string;
    }) => `${row.source}:${Number(row.gameId)}:${Number(row.platformId)}`;

    const fromHistory = new Map<string, number>();
    for (const row of history) {
        fromHistory.set(
            keyOf(row),
            (fromHistory.get(keyOf(row)) ?? 0) +
                row.totalPlaytimeInPeriodSeconds,
        );
    }

    const extra: PlaytimeRow[] = [];
    for (const row of played) {
        const total = Number(row.totalPlaytimeSeconds);
        const known =
            period === Period.YEAR
                ? total
                : Math.min(Number(row.recentPlaytimeSeconds), total);
        const missing = known - (fromHistory.get(keyOf(row)) ?? 0);
        if (missing > 0) {
            extra.push({
                gameId: Number(row.gameId),
                platformId: Number(row.platformId),
                totalPlaytimeInPeriodSeconds: missing,
            });
        }
    }
    return [...history, ...extra];
}

function sumBy(
    rows: PlaytimeRow[],
    key: (row: PlaytimeRow) => number,
): Map<number, number> {
    const totals = new Map<number, number>();
    for (const row of rows) {
        totals.set(
            key(row),
            (totals.get(key(row)) ?? 0) + row.totalPlaytimeInPeriodSeconds,
        );
    }
    return totals;
}

/** Entries with playtime, most played first, ties broken by id for stable output. */
function topEntries(
    totals: Map<number, number>,
    limit: number,
): [number, number][] {
    return [...totals.entries()]
        .filter(([, seconds]) => seconds > 0)
        .sort((a, b) => b[1] - a[1] || a[0] - b[0])
        .slice(0, limit);
}

function toWindow(rows: PlaytimeRow[]): ProfileMetricsSummaryWindowDto {
    const secondsByGame = sumBy(rows, (row) => row.gameId);
    return {
        totalPlaytimeSeconds: rows.reduce(
            (total, row) => total + row.totalPlaytimeInPeriodSeconds,
            0,
        ),
        totalGames: [...secondsByGame.values()].filter((s) => s > 0).length,
    };
}
