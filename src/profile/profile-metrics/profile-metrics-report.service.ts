import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { PlaytimeHistoryService } from "../../playtime/playtime-history.service";
import { Period, PeriodToMinusDays } from "../../utils/period";
import { ReviewsService } from "../../reviews/reviews.service";
import { CollectionsEntriesService } from "../../collections/collections-entries/collections-entries.service";
import dayjs from "dayjs";
import { MoreThanOrEqual } from "typeorm";
import { Cacheable } from "../../utils/cacheable";
import { hours } from "@nestjs/throttler";
import { ProfileMetricsReportResponseDto } from "./dto/profile-metrics-report.dto";

@Injectable()
export class ProfileMetricsReportService {
    constructor(
        private readonly playtimeHistoryService: PlaytimeHistoryService,
        private readonly reviewsService: ReviewsService,
        private readonly collectionsEntriesService: CollectionsEntriesService,
    ) {}

    @Cacheable(ProfileMetricsReportService.name, hours(1))
    public async generateReport(
        userId: string,
        period: Period.WEEK | Period.MONTH,
    ): Promise<ProfileMetricsReportResponseDto> {
        const periodMinusDays = PeriodToMinusDays[period];
        if (periodMinusDays == undefined) {
            throw new HttpException("Invalid period", HttpStatus.BAD_REQUEST);
        }

        const sinceDate = dayjs().startOf(
            period === Period.WEEK ? "week" : "month",
        );

        const [
            reviewedInPeriod,
            playtimeSecondsInPeriod,
            { finished: finishedInPeriod, played: playedInPeriod },
        ] = await Promise.all([
            this.getReviewedInPeriod(userId, sinceDate),
            this.getPlaytimeInPeriod(userId, sinceDate),
            this.getGamesStatusInPeriod(userId, sinceDate),
        ]);

        return {
            reviewedInPeriod,
            playtimeSecondsInPeriod,
            finishedInPeriod,
            playedInPeriod,
        };
    }

    private async getReviewedInPeriod(
        userId: string,
        sinceDate: dayjs.Dayjs,
    ): Promise<number> {
        const [userReviews] = await this.reviewsService.findAllByUserId(
            userId,
            {
                limit: 9999999,
            },
        );
        const reviewsInPeriod = userReviews.filter((review) =>
            dayjs(review.createdAt).isAfter(sinceDate),
        );

        return reviewsInPeriod.length;
    }

    private async getGamesStatusInPeriod(
        userId: string,
        sinceDate: dayjs.Dayjs,
    ): Promise<{
        finished: number;
        played: number;
    }> {
        const collectionEntriesInPeriod =
            await this.collectionsEntriesService.findAllBy({
                libraryUserId: userId,
                updatedAt: MoreThanOrEqual(sinceDate.toDate()),
            });

        const finishedInPeriod = collectionEntriesInPeriod.filter((entry) =>
            entry.finishedAt
                ? dayjs(entry.finishedAt).isAfter(sinceDate)
                : false,
        ).length;
        const playedInPeriod = collectionEntriesInPeriod.filter((entry) =>
            entry.startedAt ? dayjs(entry.startedAt).isAfter(sinceDate) : false,
        ).length;

        return {
            finished: finishedInPeriod,
            played: playedInPeriod,
        };
    }

    private async getPlaytimeInPeriod(userId: string, sinceDate: dayjs.Dayjs) {
        const totalPerGame =
            await this.playtimeHistoryService.getTotalPlaytimeForPeriod({
                userId,
                startDate: sinceDate.toDate(),
                endDate: new Date(),
            });

        return totalPerGame.reduce(
            (acc, cur) => acc + cur.totalPlaytimeInPeriodSeconds,
            0,
        );
    }
}
