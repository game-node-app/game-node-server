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
    FindManyOptions,
    FindOptionsRelations,
    In,
    Repository,
} from "typeorm";
import { CreateUpdateCollectionEntryDto } from "./dto/create-update-collection-entry.dto";
import { ActivitiesQueueService } from "../../activities/activities-queue/activities-queue.service";
import { FindCollectionEntriesDto } from "./dto/find-collection-entries.dto";
import { buildBaseFindOptions } from "../../utils/buildBaseFindOptions";
import { ActivityType } from "../../activities/activities-queue/activities-queue.constants";
import { AchievementsQueueService } from "../../achievements/achievements-queue/achievements-queue.service";
import { AchievementCategory } from "../../achievements/achievements.constants";
import { getIconNamesForPlatformAbbreviations } from "../../game/game-repository/game-repository.utils";
import { LevelService } from "../../level/level.service";
import { LevelIncreaseActivities } from "../../level/level.constants";
import { CollectionsService } from "../collections.service";
import { FindCollectionEntriesForCollectionIdDto } from "./dto/find-collection-entries-for-collection-id.dto";

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
        private achievementsQueueService: AchievementsQueueService,
        private levelService: LevelService,
        @Inject(forwardRef(() => CollectionsService))
        private collectionsService: CollectionsService,
    ) {}

    async findOneById(id: string) {
        return await this.collectionEntriesRepository.findOne({
            where: {
                id,
            },
        });
    }

    async findOneByIdOrFail(id: string) {
        const entry = await this.findOneById(id);
        if (!entry) {
            throw new HttpException("No entry found.", HttpStatus.NOT_FOUND);
        }
        return entry;
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
                    libraryUserId: userId,
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
        const findOptions = buildBaseFindOptions<CollectionEntry>({
            ...dto,
            orderBy: undefined,
        });

        return await this.collectionEntriesRepository.find({
            ...findOptions,
            where: {
                id: In(collectionEntryIds),
            },
            order: {
                createdAt: dto?.orderBy?.addedDate,
                game: {
                    firstReleaseDate: dto?.orderBy?.releaseDate,
                },
            },
            relations: {
                ...this.relations,
                game: dto?.orderBy?.releaseDate != undefined,
            },
        });
    }

    async findAllByCollectionIdWithPermissions(
        userId: string | undefined,
        collectionId: string,
        dto?: FindCollectionEntriesForCollectionIdDto,
    ) {
        const baseFindOptions = buildBaseFindOptions<CollectionEntry>({
            ...dto,
            orderBy: undefined,
        });

        const findOptions: FindManyOptions<CollectionEntry> = {
            ...baseFindOptions,
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
            order: {
                createdAt: dto?.orderBy?.addedDate,
                game: {
                    firstReleaseDate: dto?.orderBy?.releaseDate,
                },
            },
            relations: {
                ...this.relations,
                game: dto?.orderBy?.releaseDate != undefined,
            },
        };

        return await this.collectionEntriesRepository.findAndCount(findOptions);
    }

    async findAllByUserIdWithPermissions(
        userId: string | undefined,
        targetUserId: string,
        dto: FindCollectionEntriesDto,
    ) {
        const isOwnQuery = userId === targetUserId;
        const findOptions = buildBaseFindOptions({
            ...dto,
            orderBy: undefined,
        });

        if (isOwnQuery) {
            return await this.collectionEntriesRepository.findAndCount({
                ...findOptions,
                where: {
                    collections: {
                        library: {
                            userId: targetUserId,
                        },
                    },
                },
                order: {
                    createdAt: dto?.orderBy?.addedDate,
                    game: {
                        firstReleaseDate: dto?.orderBy?.releaseDate,
                    },
                },
                relations: {
                    ...this.relations,
                    game: dto?.orderBy?.releaseDate != undefined,
                },
            });
        }

        return await this.collectionEntriesRepository.findAndCount({
            ...findOptions,
            where: {
                collections: {
                    isPublic: true,
                    library: {
                        userId: targetUserId,
                    },
                },
            },
            order: {
                createdAt: dto?.orderBy?.addedDate,
                game: {
                    firstReleaseDate: dto?.orderBy?.releaseDate,
                },
            },
            relations: {
                ...this.relations,
                game: dto?.orderBy?.releaseDate != undefined,
            },
        });
    }

    async findFavoritesByUserId(
        userId: string | undefined,
        targetUserId: string,
        dto: FindCollectionEntriesDto,
    ) {
        const findOptions = buildBaseFindOptions({
            ...dto,
            orderBy: undefined,
        });
        const isOwnQuery = userId === targetUserId;
        if (isOwnQuery) {
            return await this.collectionEntriesRepository.findAndCount({
                ...findOptions,
                where: {
                    isFavorite: true,
                    collections: {
                        library: {
                            userId: targetUserId,
                        },
                    },
                },
                order: {
                    createdAt: dto?.orderBy?.addedDate,
                    game: {
                        firstReleaseDate: dto?.orderBy?.releaseDate,
                    },
                },
                relations: {
                    ...this.relations,
                    game: dto?.orderBy?.releaseDate != undefined,
                },
            });
        }

        return await this.collectionEntriesRepository.findAndCount({
            ...findOptions,
            where: {
                isFavorite: true,
                collections: {
                    library: {
                        userId: targetUserId,
                    },
                    isPublic: true,
                },
            },
            order: {
                createdAt: dto?.orderBy?.addedDate,
                game: {
                    firstReleaseDate: dto?.orderBy?.releaseDate,
                },
            },
            relations: {
                ...this.relations,
                game: dto?.orderBy?.releaseDate != undefined,
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
        createEntryDto: CreateUpdateCollectionEntryDto,
    ) {
        const { collectionIds, gameId, platformIds, isFavorite, finishedAt } =
            createEntryDto;

        const uniqueCollectionIds = Array.from(new Set(collectionIds));
        const uniquePlatformIds = Array.from(new Set(platformIds));

        if (uniqueCollectionIds.length === 0) {
            throw new HttpException(
                "At least one collection id must be informed",
                HttpStatus.BAD_REQUEST,
            );
        } else if (uniquePlatformIds.length === 0) {
            throw new HttpException(
                "At least one platform id must be informed",
                HttpStatus.BAD_REQUEST,
            );
        }

        const collections = uniqueCollectionIds.map((id) => ({
            id: id,
        }));

        const ownedPlatforms = uniquePlatformIds.map((id) => ({
            id: id,
        }));

        const possibleExistingEntry = await this.findOneByUserIdAndGameId(
            userId,
            gameId,
        );

        const collectionEntities =
            await this.collectionsService.findAllByIds(uniqueCollectionIds);

        const isInFinishedGamesCollection = collectionEntities.some(
            (collection) => collection.isFinished,
        );

        const updatedPartialEntity: DeepPartial<CollectionEntry> = {
            ...possibleExistingEntry,
            isFavorite,
            finishedAt,
            collections,
            gameId,
            ownedPlatforms,
        };

        if (
            isInFinishedGamesCollection &&
            updatedPartialEntity.finishedAt == undefined
        ) {
            updatedPartialEntity.finishedAt = new Date();
        }

        const firstFinishedStatusChange =
            possibleExistingEntry?.finishedAt == undefined &&
            updatedPartialEntity.finishedAt != undefined;

        const upsertedEntry =
            await this.collectionEntriesRepository.save(updatedPartialEntity);

        if (!possibleExistingEntry) {
            this.levelService.registerLevelExpIncreaseActivity(
                userId,
                LevelIncreaseActivities.COLLECTION_ENTRY_CREATED,
            );
        }

        if (firstFinishedStatusChange) {
            this.levelService.registerLevelExpIncreaseActivity(
                userId,
                LevelIncreaseActivities.GAME_FINISHED,
            );
        }

        for (const uniqueCollectionId of uniqueCollectionIds) {
            this.activitiesQueueService.register({
                sourceId: upsertedEntry.id,
                complementarySourceId: uniqueCollectionId,
                type: ActivityType.COLLECTION_ENTRY,
                profileUserId: userId,
            });
        }

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

    /**
     * Removes a collection entry. Will also remove any entity that references it and has the DELETE cascade on.
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
                review: true,
            },
        });

        if (!entry) {
            throw new HttpException("Entry not found.", HttpStatus.NOT_FOUND);
        }

        // This removes both the associated review (if any) and the entries in the join-tables.
        await this.collectionEntriesRepository.delete(entry.id);
    }

    async findIconsForOwnedPlatforms(entryId: string) {
        const entry = await this.collectionEntriesRepository.findOneOrFail({
            where: {
                id: entryId,
            },
            relations: {
                ownedPlatforms: true,
            },
        });
        const ownedPlatforms = entry.ownedPlatforms;
        if (ownedPlatforms.length === 0) return [];
        const abbreviations = ownedPlatforms.map(
            (platform) => platform.abbreviation,
        );
        return getIconNamesForPlatformAbbreviations(abbreviations);
    }
}
