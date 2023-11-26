import {
    forwardRef,
    HttpException,
    HttpStatus,
    Inject,
    Injectable,
} from "@nestjs/common";
import { CollectionEntry } from "./entities/collection-entry.entity";
import { InjectRepository } from "@nestjs/typeorm";
import {
    DeepPartial,
    FindOptionsRelations,
    In,
    Not,
    Repository,
} from "typeorm";
import { CreateCollectionEntryDto } from "./dto/create-collection-entry.dto";
import { ActivitiesQueueService } from "../../activities/activities-queue/activities-queue.service";
import { FindCollectionEntriesDto } from "./dto/find-collection-entries.dto";
import { buildBaseFindOptions } from "../../utils/buildBaseFindOptions";
import { Activity } from "../../activities/activities-repository/entities/activity.entity";
import { ActivityType } from "../../activities/activities-queue/activities-queue.constants";
import { ReviewsService } from "../../reviews/reviews.service";

@Injectable()
export class CollectionsEntriesService {
    private readonly relations: FindOptionsRelations<CollectionEntry> = {
        collection: true,
        review: true,
        game: true,
        ownedPlatforms: true,
    };
    constructor(
        @InjectRepository(CollectionEntry)
        private collectionEntriesRepository: Repository<CollectionEntry>,
        private activitiesQueueService: ActivitiesQueueService,
        @Inject(forwardRef(() => ReviewsService))
        private reviewsService: ReviewsService,
    ) {}

    async findOneById(id: string) {
        return await this.collectionEntriesRepository.findOne({
            where: {
                id,
            },
        });
    }

    /**
     * This is mainly used to check if a given entry exists in a given user's library.
     * @param userId
     * @param gameId
     * @param dto
     */
    async findAllByUserIdAndGameId(userId: string, gameId: number) {
        return await this.collectionEntriesRepository.find({
            where: {
                collection: {
                    library: {
                        userId,
                    },
                },
                game: {
                    id: gameId,
                },
            },
            relations: this.relations,
        });
    }

    async findAllByUserIdAndGameIdOrFail(userId: string, gameId: number) {
        const entry = await this.findAllByUserIdAndGameId(userId, gameId);
        if (!entry) {
            throw new HttpException(
                "Collection entry not found.",
                HttpStatus.NOT_FOUND,
            );
        }
        return entry;
    }

    async findAllByIdIn(
        collectionEntryIds: string[],
        dto?: FindCollectionEntriesDto,
    ) {
        const findOptions = buildBaseFindOptions<CollectionEntry>(dto);
        return await this.collectionEntriesRepository.find({
            ...findOptions,
            where: {
                id: In(collectionEntryIds),
            },
        });
    }

    async findAllByCollectionId(
        userId: string,
        collectionId: string,
        dto?: FindCollectionEntriesDto,
    ) {
        const findOptions = buildBaseFindOptions<CollectionEntry>(dto);

        const results = await this.collectionEntriesRepository.findAndCount({
            ...findOptions,
            where: {
                collection: [
                    {
                        id: collectionId,
                        isPublic: true,
                    },
                    {
                        id: collectionId,
                        library: {
                            userId,
                        },
                    },
                ],
            },
            relations: this.relations,
        });
        return results;
    }

    async findAllByUserId(userId: string, dto: FindCollectionEntriesDto) {
        const findOptions = buildBaseFindOptions(dto);
        return await this.collectionEntriesRepository.find({
            ...findOptions,
            where: {
                collection: {
                    library: {
                        userId,
                    },
                },
            },
        });
    }

    async getFavoritesByUserId(userId: string, dto: FindCollectionEntriesDto) {
        const findOptions = buildBaseFindOptions(dto);
        return await this.collectionEntriesRepository.find({
            ...findOptions,
            where: {
                collection: {
                    isPublic: true,
                    library: {
                        userId: userId,
                    },
                },
            },
        });
    }

    /**
     * Create or update a collection entry. If the game already exists for the given collection, it will be updated.
     * @param userId
     * @param createEntryDto
     */
    async createOrUpdate(
        userId: string,
        createEntryDto: CreateCollectionEntryDto,
    ) {
        const { collectionIds, gameId, platformIds, isFavorite } =
            createEntryDto;

        const uniqueCollectionIds = Array.from(new Set(collectionIds));
        const uniquePlatformIds = Array.from(new Set(platformIds));

        const queryBuilder =
            this.collectionEntriesRepository.createQueryBuilder();

        const entriesInOtherCollections =
            await this.collectionEntriesRepository.find({
                where: {
                    collection: {
                        id: Not(In(uniqueCollectionIds)),
                        library: {
                            userId: userId,
                        },
                    },
                    game: {
                        id: gameId,
                    },
                },
                relations: {
                    ownedPlatforms: true,
                },
            });

        // Removes entry from other collections before proceeding
        for (const entry of entriesInOtherCollections) {
            await queryBuilder
                .relation(CollectionEntry, "ownedPlatforms")
                .of(entry)
                .remove(entry.ownedPlatforms);
            await this.collectionEntriesRepository.delete(entry.id);
        }

        for (const collectionId of uniqueCollectionIds) {
            const entryInCollection =
                await this.collectionEntriesRepository.findOne({
                    where: {
                        collection: {
                            id: collectionId,
                        },
                        game: {
                            id: gameId,
                        },
                    },
                    relations: {
                        ownedPlatforms: true,
                    },
                });

            if (entryInCollection != undefined) {
                const updatedEntry = this.collectionEntriesRepository.merge(
                    entryInCollection,
                    {
                        game: {
                            id: gameId,
                        },
                        collection: {
                            id: collectionId,
                        },
                        isFavorite,
                    },
                );
                await this.collectionEntriesRepository.upsert(updatedEntry, [
                    "id",
                ]);

                // Removes previous platforms before adding the new ones
                await queryBuilder
                    .relation(CollectionEntry, "ownedPlatforms")
                    .of(entryInCollection)
                    .remove(entryInCollection.ownedPlatforms);
                await queryBuilder
                    .relation(CollectionEntry, "ownedPlatforms")
                    .of(updatedEntry)
                    .add(uniquePlatformIds);

                continue;
            }

            const relatedReview =
                await this.reviewsService.findOneByUserIdAndGameId(
                    userId,
                    gameId,
                );

            const persistedEntry = await this.collectionEntriesRepository.save({
                collection: {
                    id: collectionId,
                },
                game: {
                    id: gameId,
                },
                ownedPlatforms: platformIds.map((platformId) => ({
                    id: platformId,
                })),
                reviewId: relatedReview?.id,
                review: relatedReview,
                isFavorite,
            });

            const activity: DeepPartial<Activity> = {
                profile: {
                    userId,
                },
                sourceId: persistedEntry.id,
                type: ActivityType.COLLECTION_ENTRY,
            };

            this.activitiesQueueService.addActivity(activity).then().catch();
        }
    }

    /**
     * Should be called after the review has been created.
     * Should only be called from the ReviewsService.
     * @param userId
     * @param gameId
     * @param reviewId
     */
    async attachReview(userId: string, gameId: number, reviewId: string) {
        const entries = await this.findAllByUserIdAndGameIdOrFail(
            userId,
            gameId,
        );
        for (const entry of entries) {
            await this.collectionEntriesRepository
                .createQueryBuilder()
                .relation(CollectionEntry, "review")
                .of(entry)
                .set(reviewId);
        }
    }

    /**
     * Should be called when a review is to be removed.
     * @param userId
     * @param reviewId
     */
    async detachReview(userId: string, entryId: string, reviewId: string) {
        const entries = await this.collectionEntriesRepository.find({
            where: {
                collection: {
                    library: {
                        userId,
                    },
                },
                id: entryId,
                reviewId: reviewId,
            },
        });
        if (entries == undefined || entries.length === 0) {
            return;
        }
        for (const entry of entries) {
            await this.collectionEntriesRepository
                .createQueryBuilder()
                .relation(CollectionEntry, "review")
                .of(entry)
                .set(null);
        }
    }

    async changeFavoriteStatus(
        userId: string,
        gameId: number,
        isFavorite: boolean = false,
    ) {
        const entities = await this.findAllByUserIdAndGameIdOrFail(
            userId,
            gameId,
        );
        for (const entity of entities) {
            await this.collectionEntriesRepository.update(
                {
                    id: entity.id,
                },
                {
                    isFavorite,
                },
            );
        }
    }

    async deleteByUserIdAndGameId(userId: string, gameId: number) {
        const entities = await this.findAllByUserIdAndGameIdOrFail(
            userId,
            gameId,
        );
        for (const entity of entities) {
            await this.delete(userId, entity.id);
        }
    }

    /**
     * This method should not be exposed directly in a controller.
     * @param userId
     * @param entryId
     */
    async delete(userId: string, entryId: string) {
        const entry = await this.collectionEntriesRepository.findOne({
            where: {
                id: entryId,
                collection: {
                    library: {
                        userId,
                    },
                },
            },
            relations: {
                review: true,
                ownedPlatforms: true,
            },
        });
        if (!entry) {
            throw new HttpException("Entry not found.", HttpStatus.NOT_FOUND);
        }

        if (entry.review) {
            try {
                await this.detachReview(userId, entry.id, entry.review.id);
                await this.reviewsService.delete(userId, entry.review.id);
            } catch (e) {}
        }

        const queryBuilder =
            this.collectionEntriesRepository.createQueryBuilder();
        await queryBuilder
            .relation(CollectionEntry, "ownedPlatforms")
            .of(entry)
            .remove(entry.ownedPlatforms);

        await this.collectionEntriesRepository.delete(entry.id);

        this.activitiesQueueService.deleteActivity(entry.id).then().catch();
    }
}
