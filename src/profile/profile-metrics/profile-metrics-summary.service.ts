import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { minutes } from "@nestjs/throttler";
import dayjs from "dayjs";
import { GameRepositoryService } from "../../game/game-repository/game-repository.service";
import { PlaytimeHistoryService } from "../../playtime/playtime-history.service";
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
import { LibraryAccessService } from "../../libraries/library-access.service";
import { LibraryAudience } from "../../libraries/library-visibility.constants";
import {
    LibraryAudienceKey,
    OWNER_LIBRARY_AUDIENCE_KEY,
} from "./library-audience-key";

const SUPPORTED_PERIODS: Period[] = [Period.WEEK, Period.MONTH, Period.YEAR];
const TOP_GAMES_LIMIT = 5;

type PlaytimeRow = {
    gameId: number;
    platformId: number;
    totalPlaytimeInPeriodSeconds: number;
    estimatedPlaytimeSeconds?: number;
};

/**
 * Period summary behind the recap share card: playtime deltas from the
 * playtime history plus the first Steam observation's recent-time estimate,
 * with the same figures for the previous window so clients can show the
 * change.
 */
@Injectable()
export class ProfileMetricsSummaryService {
    constructor(
        private readonly playtimeHistoryService: PlaytimeHistoryService,
        private readonly gameRepositoryService: GameRepositoryService,
        private readonly profileMetricsReportService: ProfileMetricsReportService,
        private readonly libraryAccessService: LibraryAccessService,
    ) {}

    @Cacheable(ProfileMetricsSummaryService.name, minutes(10))
    public async generateSummary(
        userId: string,
        period: ProfileMetricsSummaryPeriod,
        audience: LibraryAudienceKey = OWNER_LIBRARY_AUDIENCE_KEY,
    ): Promise<ProfileMetricsSummaryResponseDto> {
        if (!SUPPORTED_PERIODS.includes(period)) {
            throw new HttpException("Invalid period", HttpStatus.BAD_REQUEST);
        }

        if (audience.visibleEntryLevels.length === 0) {
            return emptySummary(period);
        }

        // The owner has nothing hidden, so no extra query and no LibraryAccessService needed.
        const hidden =
            audience.audience === LibraryAudience.Owner
                ? new Set<number>()
                : new Set(
                      await this.libraryAccessService.hiddenGameIds(
                          userId,
                          audience.visibleEntryLevels,
                      ),
                  );

        const now = dayjs();
        const windowStart = now.subtract(PeriodToMinusDays[period], "day");
        const previousStart = windowStart.subtract(
            PeriodToMinusDays[period],
            "day",
        );

        const [currentRows, previousRows, counts] = await Promise.all([
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
                [...hidden],
            ),
        ]);

        const visibleCurrentRows = currentRows.filter(
            (row) => !hidden.has(row.gameId),
        );
        const visiblePreviousRows = previousRows.filter(
            (row) => !hidden.has(row.gameId),
        );

        const secondsByGame = sumBy(visibleCurrentRows, (row) => row.gameId);
        const topGames = this.buildTopGames(secondsByGame);

        const [topGenre, topPlatform] = await Promise.all([
            this.findTopGenre(secondsByGame),
            this.findTopPlatform(visibleCurrentRows),
        ]);

        return {
            period,
            current: toWindow(visibleCurrentRows),
            previous: toWindow(visiblePreviousRows),
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
        estimatedPlaytimeSeconds: rows.reduce(
            (total, row) => total + (row.estimatedPlaytimeSeconds ?? 0),
            0,
        ),
        totalGames: [...secondsByGame.values()].filter((s) => s > 0).length,
    };
}

/** A hidden library shows zeros: no playtime, no ranked games, no activity counts. */
function emptySummary(
    period: ProfileMetricsSummaryPeriod,
): ProfileMetricsSummaryResponseDto {
    const emptyWindow: ProfileMetricsSummaryWindowDto = {
        totalPlaytimeSeconds: 0,
        estimatedPlaytimeSeconds: 0,
        totalGames: 0,
    };
    return {
        period,
        current: { ...emptyWindow },
        previous: { ...emptyWindow },
        topGames: [],
        topGenre: null,
        topPlatform: null,
        playedInPeriod: 0,
        finishedInPeriod: 0,
        reviewedInPeriod: 0,
    };
}
