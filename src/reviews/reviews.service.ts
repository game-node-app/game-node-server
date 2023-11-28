import { HttpException, HttpStatus } from "@nestjs/common";
import { CreateReviewDto } from "./dto/create-review.dto";
import { InjectRepository } from "@nestjs/typeorm";
import { Review } from "./entities/review.entity";
import { FindOptionsRelations, In, Repository } from "typeorm";
import { ActivitiesQueueService } from "src/activities/activities-queue/activities-queue.service";
import { ActivityType } from "src/activities/activities-queue/activities-queue.constants";
import { FindReviewDto } from "./dto/find-review.dto";
import { buildBaseFindOptions } from "../utils/buildBaseFindOptions";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Filter = require("bad-words");

export class ReviewsService {
    private readonly badWordsFilter = new Filter();
    private relations: FindOptionsRelations<Review> = {
        profile: true,
    };

    constructor(
        @InjectRepository(Review) private reviewsRepository: Repository<Review>,
        private activitiesQueue: ActivitiesQueueService,
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
            const updatedEntry = this.reviewsRepository.merge(
                possibleExistingReview,
                createReviewDto,
            );
            await this.reviewsRepository.update(updatedEntry.id, {
                id: updatedEntry.id,
                content: updatedEntry.content,
                rating: updatedEntry.rating,
            });
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

        // Do not await this, as it will block the request
        this.activitiesQueue.addActivity({
            type: ActivityType.REVIEW,
            sourceId: insertedEntry.id,
            profile: {
                userId,
            },
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
