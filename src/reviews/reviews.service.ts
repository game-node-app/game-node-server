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
import { BAD_WORDS_TAG_NAME } from "./reviews.constants";

export class ReviewsService {
    private readonly badWordsFilter = new Filter();
    private relations: FindOptionsRelations<Review> = {};

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

    private tagBadWords(content: string): string {
        const words = content.split(" ");
        const taggedWords = words.map((word) => {
            if (this.badWordsFilter.isProfane(word)) {
                return `<${BAD_WORDS_TAG_NAME}>${word}</${BAD_WORDS_TAG_NAME}>`;
            }

            return word;
        });

        return taggedWords.join(" ");
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

        createReviewDto.content = this.tagBadWords(createReviewDto.content);

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

        // Do not await this, as it will block the request
        this.activitiesQueue.addActivity({
            type: ActivityType.REVIEW,
            sourceId: insertedEntry.id,
            profileUserId: userId,
            metadata: null,
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
