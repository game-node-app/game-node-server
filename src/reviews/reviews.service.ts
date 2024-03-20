import {
    forwardRef,
    HttpException,
    HttpStatus,
    Inject,
    Logger,
} from "@nestjs/common";
import { CreateReviewDto } from "./dto/create-review.dto";
import { InjectRepository } from "@nestjs/typeorm";
import { Review } from "./entities/review.entity";
import { FindOptionsRelations, In, Repository } from "typeorm";
import { ActivitiesQueueService } from "../activities/activities-queue/activities-queue.service";
import { ActivityType } from "../activities/activities-queue/activities-queue.constants";
import { FindReviewDto } from "./dto/find-review.dto";
import { buildBaseFindOptions } from "../utils/buildBaseFindOptions";
import { CollectionsEntriesService } from "../collections/collections-entries/collections-entries.service";
import { filterBadWords } from "../utils/filterBadWords";
import { AchievementsQueueService } from "../achievements/achievements-queue/achievements-queue.service";
import { AchievementCategory } from "../achievements/achievements.constants";
import { StatisticsService } from "../statistics/statistics.service";
import { StatisticsSourceType } from "../statistics/statistics.constants";
import {
    ReviewScoreDistribution,
    ReviewScoreResponseDto,
} from "./dto/review-score-response.dto";
import { StatisticsQueueService } from "../statistics/statistics-queue/statistics-queue.service";

export class ReviewsService {
    private readonly logger = new Logger(ReviewsService.name);
    private relations: FindOptionsRelations<Review> = {};

    constructor(
        @InjectRepository(Review) private reviewsRepository: Repository<Review>,
        private activitiesQueue: ActivitiesQueueService,
        private collectionsEntriesService: CollectionsEntriesService,
        private readonly achievementsQueueService: AchievementsQueueService,
        private readonly statisticsQueueService: StatisticsQueueService,
    ) {}

    async findOneById(id: string) {
        return await this.reviewsRepository.findOne({
            where: {
                id,
            },
            relations: this.relations,
        });
    }

    async findOneByIdOrFail(id: string) {
        const review = await this.findOneById(id);
        if (!review) {
            throw new HttpException("", HttpStatus.NOT_FOUND);
        }
        return review;
    }

    async findOneByUserIdAndGameId(userId: string, gameId: number) {
        const review = await this.reviewsRepository.findOne({
            where: {
                game: {
                    id: gameId,
                },
                profile: {
                    userId,
                },
            },
            relations: this.relations,
        });
        return review;
    }

    async findAllByUserId(userId: string, dto: FindReviewDto | undefined) {
        const findOptions = buildBaseFindOptions(dto);
        return await this.reviewsRepository.findAndCount({
            ...findOptions,
            where: {
                profile: {
                    userId,
                },
            },
            relations: this.relations,
        });
    }

    async findAllByGameId(gameId: number, dto?: FindReviewDto) {
        const findOptions = buildBaseFindOptions(dto);
        return await this.reviewsRepository.findAndCount({
            ...findOptions,
            where: {
                game: {
                    id: gameId,
                },
            },
            relations: this.relations,
        });
    }

    async findAllByIdIn(ids: string[]) {
        return await this.reviewsRepository.find({
            where: {
                id: In(ids),
            },
            relations: this.relations,
        });
    }

    private getReviewsScoreDistribution(
        reviews: Review[],
    ): ReviewScoreDistribution {
        const distribution: ReviewScoreDistribution = {
            "1": 0,
            "2": 0,
            "3": 0,
            "4": 0,
            "5": 0,
            total: reviews.length,
        };
        for (const num of [1, 2, 3, 4, 5] as const) {
            const items = reviews.filter(
                (review) => review != undefined && review.rating === num,
            );
            distribution[`${num}`] = items.length;
        }

        return distribution;
    }

    private getScoresMedian(scores: number[]) {
        if (scores.length === 0) {
            return 0;
        } else if (scores.length === 1) {
            return scores[0];
        }
        const sortedScores = scores.toSorted((a, b) => a - b);
        const middleIndex = Math.ceil(sortedScores.length / 2);
        if (sortedScores.length % 2) {
            return (
                (sortedScores[middleIndex - 1] + sortedScores[middleIndex]) / 2
            );
        }

        return sortedScores[middleIndex];
    }

    async getScore(gameId: number): Promise<ReviewScoreResponseDto> {
        const reviews = await this.reviewsRepository.findBy({
            gameId: gameId,
        });
        const scores = reviews.map((review) => {
            return review.rating;
        });
        const median = this.getScoresMedian(scores);
        const distribution = this.getReviewsScoreDistribution(reviews);
        return {
            median,
            distribution,
        };
    }

    async createOrUpdate(userId: string, createReviewDto: CreateReviewDto) {
        const collectionEntry =
            await this.collectionsEntriesService.findOneByUserIdAndGameIdOrFail(
                userId,
                createReviewDto.gameId,
            );

        const possibleExistingReview = await this.findOneByUserIdAndGameId(
            userId,
            createReviewDto.gameId,
        );

        createReviewDto.content = filterBadWords(createReviewDto.content);

        if (possibleExistingReview) {
            const mergedEntry = this.reviewsRepository.merge(
                possibleExistingReview,
                createReviewDto,
            );
            await this.reviewsRepository.update(mergedEntry.id, mergedEntry);
            return;
        }

        const reviewEntity = this.reviewsRepository.create({
            ...createReviewDto,
            game: {
                id: createReviewDto.gameId,
            },
            profile: {
                userId,
            },
            collectionEntry: collectionEntry,
        });

        const insertedEntry = await this.reviewsRepository.save(reviewEntity);

        this.activitiesQueue.addActivity({
            type: ActivityType.REVIEW,
            sourceId: insertedEntry.id,
            profileUserId: userId,
            metadata: null,
        });

        this.achievementsQueueService.addTrackingJob({
            targetUserId: userId,
            category: AchievementCategory.REVIEWS,
        });

        this.statisticsQueueService.createStatistics({
            sourceType: StatisticsSourceType.REVIEW,
            sourceId: insertedEntry.id,
        });
    }

    async delete(userId: string, reviewId: string) {
        const review = await this.reviewsRepository.findOne({
            where: {
                id: reviewId,
                profile: {
                    userId,
                },
            },
            relations: {
                collectionEntry: true,
            },
        });
        if (review == undefined) {
            throw new HttpException("No review found.", HttpStatus.NOT_FOUND);
        }

        await this.reviewsRepository.delete({
            id: reviewId,
            profile: {
                userId,
            },
        });

        this.activitiesQueue.deleteActivity(review.id);
    }
}
