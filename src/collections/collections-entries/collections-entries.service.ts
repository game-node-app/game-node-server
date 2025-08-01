import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { CollectionEntry } from "./entities/collection-entry.entity";
import { InjectRepository } from "@nestjs/typeorm";
import {
    DeepPartial,
    FindManyOptions,
    FindOptionsRelations,
    FindOptionsWhere,
    In,
    Not,
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
import { CollectionEntryToCollection } from "./entities/collection-entry-to-collection.entity";
import { CollectionEntryStatus } from "./collections-entries.constants";
import { match } from "ts-pattern";
import { buildGameFilterFindOptions } from "../../game/game-repository/utils/build-game-filter-find-options";
import { Transactional } from "typeorm-transactional";
import { GameRepositoryService } from "../../game/game-repository/game-repository.service";
import { FindRelatedCollectionEntriesResponseDto } from "./dto/find-related-collection-entries.dto";
import { toMap } from "../../utils/toMap";

@Injectable()
export class CollectionsEntriesService {
    private readonly relations: FindOptionsRelations<CollectionEntry> = {
        collectionsMap: {
            collection: true,
        },
        game: true,
        ownedPlatforms: true,
    };

    constructor(
        @InjectRepository(CollectionEntry)
        private collectionEntriesRepository: Repository<CollectionEntry>,
        @InjectRepository(CollectionEntryToCollection)
        private collectionEntryToCollectionRepository: Repository<CollectionEntryToCollection>,
        private activitiesQueueService: ActivitiesQueueService,
        private achievementsQueueService: AchievementsQueueService,
        private levelService: LevelService,
        private collectionsService: CollectionsService,
        private gameRepositoryService: GameRepositoryService,
    ) {}

    async findOneById(id: string) {
        return await this.collectionEntriesRepository.findOne({
            where: {
                id,
            },
            relations: this.relations,
        });
    }

    async findRelatedEntries(
        collectionEntryId: string,
    ): Promise<FindRelatedCollectionEntriesResponseDto> {
        const entry = await this.findOneByIdOrFail(collectionEntryId);
        const { dlcs, expansions } =
            await this.gameRepositoryService.findOneById(entry.gameId, {
                relations: {
                    dlcs: true,
                    expansions: true,
                },
            });

        const gameIds = [...dlcs, ...expansions].map((game) => game.id);

        if (gameIds.length === 0) {
            throw new HttpException(
                "No related games found.",
                HttpStatus.NOT_FOUND,
            );
        }

        const entriesInGameIds = await this.collectionEntriesRepository
            .createQueryBuilder("ce")
            .where("ce.libraryUserId = :libraryUserId", {
                libraryUserId: entry.libraryUserId,
            })
            .andWhere("ce.gameId IN (:...gameIds)", {
                gameIds,
            })
            .getMany();

        if (entriesInGameIds.length === 0) {
            throw new HttpException(
                "No related games found.",
                HttpStatus.NOT_FOUND,
            );
        }

        const mappedByGameId = toMap(entriesInGameIds, "gameId");

        return {
            dlcs: dlcs
                .map((game) => mappedByGameId.get(game.id))
                .filter((entry) => entry != undefined),
            expansions: expansions
                .map((game) => mappedByGameId.get(game.id))
                .filter((entry) => entry != undefined),
        };
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
                libraryUserId: userId,
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
            relations: this.relations,
        });
    }

    async findAllBy(by: FindOptionsWhere<CollectionEntry>) {
        return this.collectionEntriesRepository.findBy(by);
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
                collectionsMap: {
                    collection: [
                        {
                            id: collectionId,
                            isPublic: true,
                        },
                        {
                            id: collectionId,
                            libraryUserId: userId,
                        },
                    ],
                },
                game: buildGameFilterFindOptions(dto?.gameFilters),
            },
            order: {
                createdAt: dto?.orderBy?.addedDate,
                game: {
                    firstReleaseDate: dto?.orderBy?.releaseDate,
                },
            },
            relations: this.relations,
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

        return await this.collectionEntriesRepository.findAndCount({
            ...findOptions,
            where: {
                collectionsMap: {
                    collection: {
                        isPublic: isOwnQuery ? undefined : true,
                    },
                },
                libraryUserId: targetUserId,
                status: dto.status,
                game: buildGameFilterFindOptions(dto.gameFilters),
            },
            order: {
                createdAt: dto?.orderBy?.addedDate,
                game: {
                    firstReleaseDate: dto?.orderBy?.releaseDate,
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
        const findOptions = buildBaseFindOptions({
            ...dto,
            orderBy: undefined,
        });

        const isOwnQuery = userId != undefined && userId === targetUserId;

        return await this.collectionEntriesRepository.findAndCount({
            ...findOptions,
            where: {
                isFavorite: true,
                collectionsMap: {
                    collection: {
                        isPublic: isOwnQuery ? undefined : true,
                    },
                },
                libraryUserId: targetUserId,
                status: dto.status,
            },
            order: {
                createdAt: dto?.orderBy?.addedDate,
                game: {
                    firstReleaseDate: dto?.orderBy?.releaseDate,
                },
            },
            relations: this.relations,
        });
    }

    /**
     * Create or update a user's Collection Entry
     * @param userId
     * @param createEntryDto
     */
    @Transactional()
    async createOrUpdate(
        userId: string,
        createEntryDto: CreateUpdateCollectionEntryDto,
    ) {
        const {
            collectionIds,
            gameId,
            platformIds,
            finishedAt,
            status,
            relatedGameIds,
        } = createEntryDto;

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

        const ownedPlatforms = uniquePlatformIds.map((id) => ({
            id: id,
        }));

        const inferredStatusAndDates = await this.inferStatusAndAssociatedDates(
            uniqueCollectionIds,
            status,
            finishedAt,
        );

        const possibleExistingEntry = await this.findOneByUserIdAndGameId(
            userId,
            gameId,
        );

        const updatedPartialEntity: DeepPartial<CollectionEntry> = {
            ...possibleExistingEntry,
            libraryUserId: userId,
            finishedAt,
            gameId,
            // Updated automatically with @ManyToMany
            ownedPlatforms,
            ...inferredStatusAndDates,
        };

        const upsertedEntry =
            await this.collectionEntriesRepository.save(updatedPartialEntity);

        if (uniqueCollectionIds.length > 0) {
            await this.updateAssociatedCollections(
                upsertedEntry.id,
                uniqueCollectionIds,
            );
        }

        if (relatedGameIds) {
            await this.processRelatedEntries(
                upsertedEntry,
                relatedGameIds,
                uniquePlatformIds,
            );
        }

        if (!possibleExistingEntry) {
            this.levelService.registerLevelExpIncreaseActivity(
                userId,
                LevelIncreaseActivities.COLLECTION_ENTRY_CREATED,
            );
        }

        const firstFinishedStatusChange =
            possibleExistingEntry?.finishedAt === null &&
            updatedPartialEntity.finishedAt != undefined;

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

    private async updateAssociatedCollections(
        collectionEntryId: string,
        collectionIds: string[],
    ) {
        // Deletes stale relations
        await this.collectionEntryToCollectionRepository.delete({
            collectionEntryId,
            collectionId: Not(In(collectionIds)),
        });

        const existingMaps =
            await this.collectionEntryToCollectionRepository.findBy({
                collectionEntryId,
            });

        const existingCollectionIds = new Set(
            existingMaps.map((map) => map.collectionId),
        );

        const newCollectionIds = collectionIds.filter(
            (collectionId) => !existingCollectionIds.has(collectionId),
        );

        if (newCollectionIds.length === 0) return;

        const maxOrdersRaw = await this.collectionEntryToCollectionRepository
            .createQueryBuilder("cetc")
            .select("cetc.collectionId", "collectionId")
            .addSelect("MAX(cetc.order)", "maxOrder")
            .where("cetc.collectionId IN (:...collectionIds)", {
                collectionIds: newCollectionIds,
            })
            .groupBy("cetc.collectionId")
            .getRawMany<{ collectionId: string; maxOrder: number }>();

        const maxOrderMap = new Map<string, number>(
            maxOrdersRaw.map((row) => [row.collectionId, Number(row.maxOrder)]),
        );

        for (const collectionId of newCollectionIds) {
            const lastOrder = maxOrderMap.get(collectionId) ?? 0;
            const newOrder = lastOrder + 10;

            await this.collectionEntryToCollectionRepository.insert({
                collectionEntryId,
                collectionId,
                order: newOrder,
            });
        }
    }

    /**
     * Infer a collection entry's status from it's parent collection and automatically returns the associated status date
     * (e.g. startedAt, finishedAt) if relevant.
     * @private
     */
    private async inferStatusAndAssociatedDates(
        collectionIds: string[],
        // TODO: remove nullish type after mobile updates
        status: CollectionEntryStatus | null | undefined,
        finishedAt: Date | null | undefined,
    ): Promise<
        Partial<
            Pick<
                CollectionEntry,
                | "status"
                | "startedAt"
                | "finishedAt"
                | "droppedAt"
                | "plannedAt"
            >
        >
    > {
        const associatedCollections =
            await this.collectionsService.findAllByIds(collectionIds);

        const firstCollectionWithDefaultStatus = associatedCollections.find(
            (collection) => collection.defaultEntryStatus != undefined,
        );

        const matchingStatus =
            firstCollectionWithDefaultStatus?.defaultEntryStatus ?? status;

        if (matchingStatus == undefined) {
            return {};
        }

        return match(matchingStatus)
            .with(CollectionEntryStatus.PLANNED, () => ({
                status: CollectionEntryStatus.PLANNED,
                plannedAt: new Date(),
            }))
            .with(CollectionEntryStatus.PLAYING, () => ({
                status: CollectionEntryStatus.PLAYING,
                startedAt: new Date(),
            }))
            .with(CollectionEntryStatus.DROPPED, () => ({
                status: CollectionEntryStatus.DROPPED,
                droppedAt: new Date(),
            }))
            .with(CollectionEntryStatus.FINISHED, () => ({
                status: CollectionEntryStatus.FINISHED,
                finishedAt: finishedAt ?? new Date(),
            }))
            .exhaustive();
    }

    /**
     * Creates collection entries entities for each related game id, if necessary.
     * @param parentEntry
     * @param relatedGameIds
     * @param platformIds
     * @private
     */
    private async processRelatedEntries(
        parentEntry: CollectionEntry,
        relatedGameIds: number[],
        platformIds: number[],
    ) {
        const ownedPlatforms = platformIds.map((id) => ({ id }));

        for (const relatedGameId of relatedGameIds) {
            const existing = await this.findOneByUserIdAndGameId(
                parentEntry.libraryUserId,
                relatedGameId,
            );

            if (existing) continue;

            const relatedEntry: DeepPartial<CollectionEntry> = {
                libraryUserId: parentEntry.libraryUserId,
                gameId: relatedGameId,
                ownedPlatforms,
                status: parentEntry.status,
                startedAt: parentEntry.startedAt,
                finishedAt: parentEntry.finishedAt,
                droppedAt: parentEntry.droppedAt,
                plannedAt: parentEntry.plannedAt,
            };

            await this.collectionEntriesRepository.save(relatedEntry);
        }
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
                collectionsMap: {
                    collection: {
                        libraryUserId: userId,
                    },
                },
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
