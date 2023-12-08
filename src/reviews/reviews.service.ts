import { forwardRef, HttpException, HttpStatus, Inject } from "@nestjs/common";
import { CreateReviewDto } from "./dto/create-review.dto";
import { InjectRepository } from "@nestjs/typeorm";
import { Review } from "./entities/review.entity";
import { FindOptionsRelations, In, Repository } from "typeorm";
import { ActivitiesQueueService } from "../activities/activities-queue/activities-queue.service";
import { ActivityType } from "../activities/activities-queue/activities-queue.constants";
import { FindReviewDto } from "./dto/find-review.dto";
import { buildBaseFindOptions } from "../utils/buildBaseFindOptions";
import Filter from "bad-words";
import { CollectionsEntriesService } from "../collections/collections-entries/collections-entries.service";

export class ReviewsService {
    private readonly badWordsFilter = new Filter();
    private relations: FindOptionsRelations<Review> = {
        profile: true,
    };

    constructor(
        @InjectRepository(Review) private reviewsRepository: Repository<Review>,
        private activitiesQueue: ActivitiesQueueService,
        @Inject(forwardRef(() => CollectionsEntriesService))
        private collectionsEntriesService: CollectionsEntriesService,
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

    async createOrUpdate(userId: string, createReviewDto: CreateReviewDto) {
        await this.collectionsEntriesService.findOneByUserIdAndGameIdOrFail(
            userId,
            createReviewDto.gameId,
        );

        const possibleExistingReview = await this.findOneByUserIdAndGameId(
            userId,
            createReviewDto.gameId,
        );

        // Censors bad words from content
        // TODO: Check if this is enough
        createReviewDto.content = this.badWordsFilter.clean(
            createReviewDto.content,
        );

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
        });

        const insertedEntry = await this.reviewsRepository.save(reviewEntity);

        await this.collectionsEntriesService.attachReview(
            userId,
            createReviewDto.gameId,
            insertedEntry.id,
        );

        // Do not await this, as it will block the request
        this.activitiesQueue
            .addActivity({
                type: ActivityType.REVIEW,
                sourceId: insertedEntry.id,
                profileUserId: userId,
                metadata: null,
            })
            .then()
            .catch();
    }

    async delete(
        userId: string,
        reviewId: string,
        detachCollectionEntry = true,
    ) {
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

        if (review.collectionEntry && detachCollectionEntry) {
            await this.collectionsEntriesService.detachReview(
                review.collectionEntry.id,
            );
        }

        await this.reviewsRepository.delete({
            id: reviewId,
            profile: {
                userId,
            },
        });

        this.activitiesQueue.deleteActivity(review.id).then().catch();
    }
}
