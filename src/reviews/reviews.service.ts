import { forwardRef, HttpException, HttpStatus, Inject } from "@nestjs/common";
import { CreateReviewDto } from "./dto/create-review.dto";
import { UpdateReviewDto } from "./dto/update-review.dto";
import { InjectRepository } from "@nestjs/typeorm";
import { Review } from "./entities/review.entity";
import { FindOptionsRelations, In, Repository } from "typeorm";
import { ProfileService } from "../profile/profile.service";
import { ActivitiesQueueService } from "src/activities/activities-queue/activities-queue.service";
import { ActivityType } from "src/activities/activities-queue/activities-queue.constants";
import { CollectionsEntriesService } from "../collections/collections-entries/collections-entries.service";

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
        @Inject(forwardRef(() => CollectionsEntriesService))
        private collectionEntriesService: CollectionsEntriesService,
    ) {}

    async findOneById(id: string) {
        return await this.reviewsRepository.findOne({
            where: {
                id,
            },
            relations: this.relations,
        });
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

    async findAllByUserId(userId: string) {
        return await this.reviewsRepository.find({
            where: {
                profile: {
                    userId,
                },
            },
            relations: this.relations,
        });
    }

    async findAllByGameId(gameId: number) {
        return await this.reviewsRepository.findAndCount({
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

    async createOrUpdate(userId: string, createReviewDto: CreateReviewDto) {
        const profile = await this.profileService.findOneById(userId);
        if (!profile) {
            throw new HttpException("Profile not found.", 404);
        }

        await this.collectionEntriesService.findAllByUserIdAndGameIdOrFail(
            userId,
            createReviewDto.gameId,
        );

        const possibleExistingReview = await this.findOneByUserIdAndGameId(
            userId,
            createReviewDto.gameId,
        );

        if (possibleExistingReview) {
            const updatedEntry = this.reviewsRepository.merge(
                possibleExistingReview,
                createReviewDto,
            );
            await this.reviewsRepository.update(updatedEntry.id, updatedEntry);
            return;
        }

        const reviewEntity = this.reviewsRepository.create({
            ...createReviewDto,
            game: {
                id: createReviewDto.gameId,
            },
            profile,
        });

        const insertedEntry = await this.reviewsRepository.save(reviewEntity);

        // Do not await this, as it will block the request
        this.activitiesQueue.addToQueue({
            type: ActivityType.REVIEW,
            sourceId: insertedEntry.id,
            profile: profile,
        });

        this.collectionEntriesService.attachReview(
            userId,
            createReviewDto.gameId,
            insertedEntry.id,
        );
    }

    async delete(userId: string, reviewId: string) {
        await this.reviewsRepository.delete({
            id: reviewId,
            profile: {
                userId,
            },
        });
    }
}
