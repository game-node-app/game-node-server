import { HttpException, HttpStatus } from "@nestjs/common";
import { CreateReviewDto } from "./dto/create-review.dto";
import { UpdateReviewDto } from "./dto/update-review.dto";
import { InjectRepository } from "@nestjs/typeorm";
import { Review } from "./entities/review.entity";
import { FindOptionsRelations, In, Repository } from "typeorm";
import { ProfileService } from "../profile/profile.service";
import { ActivitiesQueueService } from "src/activities/activities-queue/activities-queue.service";
import { ActivityType } from "src/activities/activities-queue/activities-queue.constants";

export class ReviewsService {
    private relations: FindOptionsRelations<Review> = {
        profile: true,
        reviewStatistics: true,
    };

    // TODO: Implement activities service integration
    constructor(
        @InjectRepository(Review) private reviewsRepository: Repository<Review>,
        private profileService: ProfileService,
        private activitiesQueue: ActivitiesQueueService,
    ) {}

    async findOneById(id: string) {
        return this.reviewsRepository.findOne({
            where: {
                id,
            },
            relations: this.relations,
        });
    }

    async findOneByUserIdAndGameId(userId: string, gameId: number) {
        return this.reviewsRepository.findOne({
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
    }

    async findAllByUserId(userId: string) {
        return this.reviewsRepository.find({
            where: {
                profile: {
                    userId,
                },
            },
            relations: this.relations,
        });
    }

    async findAllByGameId(gameId: number) {
        return this.reviewsRepository.find({
            where: {
                game: {
                    id: gameId,
                },
            },
            relations: this.relations,
        });
    }

    async findAllByIdIn(ids: string[]) {
        return this.reviewsRepository.find({
            where: {
                id: In(ids),
            },
            relations: this.relations,
        });
    }

    async create(userId: string, createReviewDto: CreateReviewDto) {
        const possibleExistingReview = await this.findOneByUserIdAndGameId(
            userId,
            createReviewDto.igdbId,
        );
        if (possibleExistingReview) {
            throw new HttpException(
                "User has already reviewed this game.",
                409,
            );
        }

        const profile = await this.profileService.findOneById(userId);
        if (!profile) {
            throw new HttpException("Profile not found.", 404);
        }

        const reviewEntity = this.reviewsRepository.create({
            ...createReviewDto,
            profile,
        });

        const insertedEntry = await this.reviewsRepository.save(reviewEntity);

        // Do not await this, as it will block the request
        this.activitiesQueue.addToQueue({
            type: ActivityType.REVIEW,
            sourceId: insertedEntry.id,
            profile: profile,
        });
    }

    async update(
        userId: string,
        reviewId: string,
        updateReviewDto: UpdateReviewDto,
    ) {
        const review = await this.findOneById(reviewId);

        if (!review) {
            throw new HttpException("Review not found.", 404);
        }

        if (review.profile.userId !== userId) {
            throw new HttpException(
                "Review is not accessible.",
                HttpStatus.FORBIDDEN,
            );
        }

        const updatedReviewEntity = this.reviewsRepository.merge(
            review,
            updateReviewDto,
        );

        await this.reviewsRepository.save(updatedReviewEntity);
        // No reason to update the associated activity, as the review id is not changed
    }
}
