import {
    forwardRef,
    HttpException,
    HttpStatus,
    Inject,
    Injectable,
} from "@nestjs/common";
import { CollectionEntry } from "./entities/collection-entry.entity";
import { InjectRepository } from "@nestjs/typeorm";
import { FindOptionsRelations, In, Repository } from "typeorm";
import { CreateCollectionEntryDto } from "./dto/create-collection-entry.dto";
import { ActivitiesQueueService } from "../../activities/activities-queue/activities-queue.service";
import { FindCollectionEntriesDto } from "./dto/find-collection-entries.dto";
import { buildBaseFindOptions } from "../../utils/buildBaseFindOptions";
import { ActivityType } from "../../activities/activities-queue/activities-queue.constants";
import { ReviewsService } from "../../reviews/reviews.service";
import { AchievementsQueueService } from "../../achievements/achievements-queue/achievements-queue.service";
import { AchievementCategory } from "../../achievements/achievements.constants";

@Injectable()
export class CollectionsEntriesService {
    private readonly relations: FindOptionsRelations<CollectionEntry> = {
        collections: true,
        game: false,
        ownedPlatforms: true,
    };

    constructor(
        @InjectRepository(CollectionEntry)
        private collectionEntriesRepository: Repository<CollectionEntry>,
        private activitiesQueueService: ActivitiesQueueService,
        @Inject(forwardRef(() => ReviewsService))
        private reviewsService: ReviewsService,
        private achievementsQueueService: AchievementsQueueService,
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
     */
    async findOneByUserIdAndGameId(userId: string, gameId: number) {
        return await this.collectionEntriesRepository.findOne({
            where: {
                collections: {
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

    async findOneByUserIdAndGameIdOrFail(userId: string, gameId: number) {
        const entry = await this.findOneByUserIdAndGameId(userId, gameId);
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
        userId: string | undefined,
        collectionId: string,
        dto?: FindCollectionEntriesDto,
    ) {
        const findOptions = buildBaseFindOptions<CollectionEntry>(dto);

        const results = await this.collectionEntriesRepository.findAndCount({
            ...findOptions,
            where: {
                collections: [
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

    async findAllByUserIdWithPermissions(
        userId: string | undefined,
        targetUserId: string,
        dto: FindCollectionEntriesDto,
    ) {
        const isOwnQuery = userId === targetUserId;
        const findOptions = buildBaseFindOptions(dto);
        if (isOwnQuery) {
            return await this.collectionEntriesRepository.findAndCount({
                ...findOptions,
                where: {
                    collections: {
                        library: {
                            userId,
                        },
                    },
                },
                relations: this.relations,
            });
        }

        return await this.collectionEntriesRepository.findAndCount({
            ...findOptions,
            where: {
                collections: {
                    isPublic: true,
                    library: {
                        userId,
                    },
                },
            },
            relations: this.relations,
        });
    }

    async findFavoritesByUserId(
        userId: string | undefined,
        targetUserId: string,
        dto: FindCollectionEntriesDto,
    ) {
        const findOptions = buildBaseFindOptions(dto);
        const isOwnQuery = userId === targetUserId;
        if (isOwnQuery) {
            return await this.collectionEntriesRepository.findAndCount({
                ...findOptions,
                where: {
                    isFavorite: true,
                    collections: {
                        library: {
                            userId,
                        },
                    },
                },
                relations: this.relations,
            });
        }

        return await this.collectionEntriesRepository.findAndCount({
            ...findOptions,
            where: {
                isFavorite: true,
                collections: {
                    library: {
                        userId,
                    },
                    isPublic: true,
                },
            },
        });
    }

    /**
     * Create or update a user's Collection Entry
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

        const collections = uniqueCollectionIds.map((id) => ({
            id: id,
        }));

        const ownedPlatforms = uniquePlatformIds.map((id) => ({
            id: id,
        }));

        const relevantReview =
            await this.reviewsService.findOneByUserIdAndGameId(userId, gameId);

        const entry = await this.findOneByUserIdAndGameId(userId, gameId);
        if (entry != undefined) {
            await this.delete(userId, entry.id);
        }

        const upsertedEntry = await this.collectionEntriesRepository.save({
            ...entry,
            isFavorite,
            collections,
            game: {
                id: gameId,
            },
            ownedPlatforms,
            review: {
                id: relevantReview?.id,
            },
        });

        this.activitiesQueueService.addActivity({
            sourceId: upsertedEntry.id,
            type: ActivityType.COLLECTION_ENTRY,
            profileUserId: userId,
            metadata: null,
        });

        this.achievementsQueueService.addTrackingJob({
            targetUserId: userId,
            category: AchievementCategory.COLLECTIONS,
        });
    }

    async changeFavoriteStatus(
        userId: string,
        gameId: number,
        isFavorite: boolean,
    ) {
        const entity = await this.findOneByUserIdAndGameIdOrFail(
            userId,
            gameId,
        );

        await this.collectionEntriesRepository.update(
            {
                id: entity.id,
            },
            {
                isFavorite,
            },
        );
    }

    async detachDependencies(entry: CollectionEntry) {
        const queryBuilder =
            this.collectionEntriesRepository.createQueryBuilder();
        await queryBuilder
            .relation("collections")
            .of(entry)
            .remove(entry.collections);
        await queryBuilder
            .relation("ownedPlatforms")
            .of(entry)
            .remove(entry.ownedPlatforms);
    }

    /**
     * Removes a collection entry, and detaches it's dependencies (like collections, platforms and review).
     * @param userId
     * @param entryId
     */
    async delete(userId: string, entryId: string) {
        const entry = await this.collectionEntriesRepository.findOne({
            where: {
                id: entryId,
                collections: {
                    library: {
                        userId,
                    },
                },
            },
            relations: {
                ownedPlatforms: true,
            },
        });

        if (!entry) {
            throw new HttpException("Entry not found.", HttpStatus.NOT_FOUND);
        }

        await this.detachDependencies(entry);

        await this.collectionEntriesRepository.delete(entry.id);

        this.activitiesQueueService.deleteActivity(entry.id);
    }
}
