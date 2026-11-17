import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { PlaytimeHistoryService } from "../../playtime/playtime-history.service";
import { Period, PeriodToMinusDays } from "../../utils/period";
import { ReviewsService } from "../../reviews/reviews.service";
import { CollectionsEntriesService } from "../../collections/collections-entries/collections-entries.service";
import dayjs from "dayjs";
import { Cacheable } from "../../utils/cacheable";
import { hours } from "@nestjs/throttler";
import { ProfileMetricsReportResponseDto } from "./dto/profile-metrics-report.dto";
import { LibraryAccessService } from "../../libraries/library-access.service";
import { LibraryAudienceKey } from "./library-audience-key";

@Injectable()
export class ProfileMetricsReportService {
    constructor(
        private readonly playtimeHistoryService: PlaytimeHistoryService,
        private readonly reviewsService: ReviewsService,
        private readonly collectionsEntriesService: CollectionsEntriesService,
        private readonly libraryAccessService: LibraryAccessService,
    ) {}

    @Cacheable(ProfileMetricsReportService.name, hours(1))
    public async generateReport(
        userId: string,
        period: Period.WEEK | Period.MONTH,
        audience: LibraryAudienceKey,
    ): Promise<ProfileMetricsReportResponseDto> {
        const periodMinusDays = PeriodToMinusDays[period];
        if (periodMinusDays == undefined) {
            throw new HttpException("Invalid period", HttpStatus.BAD_REQUEST);
        }

        if (audience.visibleEntryLevels.length === 0) {
            return {
                reviewedInPeriod: 0,
                playtimeSecondsInPeriod: 0,
                finishedInPeriod: 0,
                playedInPeriod: 0,
            };
        }

        const hiddenGameIds = await this.getHiddenGameIds(userId, audience);

        const sinceDate = dayjs().startOf(
            period === Period.WEEK ? "week" : "month",
        );

        const [
            reviewedInPeriod,
            playtimeSecondsInPeriod,
            { finished: finishedInPeriod, played: playedInPeriod },
        ] = await Promise.all([
            this.getReviewedInPeriod(userId, sinceDate, hiddenGameIds),
            this.getPlaytimeInPeriod(userId, sinceDate, hiddenGameIds),
            this.getGamesStatusInPeriod(userId, sinceDate, hiddenGameIds),
        ]);

        return {
            reviewedInPeriod,
            playtimeSecondsInPeriod,
            finishedInPeriod,
            playedInPeriod,
        };
    }

    /**
     * Reviews, finished games and started games since `sinceDate`, for callers
     * that choose their own window instead of the calendar week or month.
     * `hiddenGameIds` excludes the games the viewer may not see.
     */
    public async getActivityCountsSince(
        userId: string,
        sinceDate: dayjs.Dayjs,
        hiddenGameIds: number[] = [],
    ): Promise<{ reviewed: number; finished: number; played: number }> {
        const [reviewed, { finished, played }] = await Promise.all([
            this.getReviewedInPeriod(userId, sinceDate, hiddenGameIds),
            this.getGamesStatusInPeriod(userId, sinceDate, hiddenGameIds),
        ]);

        return { reviewed, finished, played };
    }

    private getHiddenGameIds(
        userId: string,
        audience: LibraryAudienceKey,
    ): Promise<number[]> {
        return this.libraryAccessService.hiddenGameIds(
            userId,
            audience.visibleEntryLevels,
        );
    }

    private async getReviewedInPeriod(
        userId: string,
        sinceDate: dayjs.Dayjs,
        hiddenGameIds: number[],
    ): Promise<number> {
        const since = sinceDate.toDate();
        const reviewed = await this.reviewsService.countCreatedAfter(
            userId,
            since,
        );
        if (hiddenGameIds.length === 0) return reviewed;

        const [hiddenReviews] =
            await this.reviewsService.findAllByUserIdAndGameIds(
                userId,
                hiddenGameIds,
            );
        return (
            reviewed -
            hiddenReviews.filter(
                (review) => review.createdAt.getTime() > since.getTime(),
            ).length
        );
    }

    private async getGamesStatusInPeriod(
        userId: string,
        sinceDate: dayjs.Dayjs,
        hiddenGameIds: number[],
    ): Promise<{
        finished: number;
        played: number;
    }> {
        const since = sinceDate.toDate();
        if (hiddenGameIds.length === 0) {
            const { started, finished } =
                await this.collectionsEntriesService.countStartedAndFinishedAfter(
                    userId,
                    since,
                );
            return {
                finished,
                played: started,
            };
        }

        // Same window as the count query above, restricted to entries the viewer may see.
        const hidden = new Set(hiddenGameIds);
        const entries = await this.collectionsEntriesService.findAllBy({
            libraryUserId: userId,
        });
        let started = 0;
        let finished = 0;
        for (const entry of entries) {
            if (
                hidden.has(entry.gameId) ||
                entry.updatedAt.getTime() < since.getTime()
            ) {
                continue;
            }
            if (
                entry.startedAt &&
                entry.startedAt.getTime() > since.getTime()
            ) {
                started += 1;
            }
            if (
                entry.finishedAt &&
                entry.finishedAt.getTime() > since.getTime()
            ) {
                finished += 1;
            }
        }

        return { finished, played: started };
    }

    private async getPlaytimeInPeriod(
        userId: string,
        sinceDate: dayjs.Dayjs,
        hiddenGameIds: number[],
    ) {
        const totalPerGame =
            await this.playtimeHistoryService.getTotalPlaytimeForPeriod({
                userId,
                startDate: sinceDate.toDate(),
                endDate: new Date(),
            });
        const hidden = new Set(hiddenGameIds);

        return totalPerGame.reduce(
            (acc, cur) =>
                hidden.has(cur.gameId)
                    ? acc
                    : acc + cur.totalPlaytimeInPeriodSeconds,
            0,
        );
    }
}
