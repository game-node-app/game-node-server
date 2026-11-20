import { Library } from "../../libraries/entities/library.entity";
import {
    HttpException,
    HttpStatus,
    Inject,
    Injectable,
    Optional,
} from "@nestjs/common";
import { CollectionEntry } from "./entities/collection-entry.entity";
import { InjectRepository } from "@nestjs/typeorm";
import {
    And,
    Between,
    DeepPartial,
    FindManyOptions,
    FindOperator,
    FindOptionsRelations,
    FindOptionsWhere,
    In,
    Not,
    Raw,
    Repository,
} from "typeorm";
import { CreateUpdateCollectionEntryDto } from "./dto/create-update-collection-entry.dto";
import { ActivitiesQueueService } from "../../activities/activities-queue/activities-queue.service";
import { FindCollectionEntriesDto } from "./dto/find-collection-entries.dto";
import { buildBaseFindOptions } from "../../utils/buildBaseFindOptions";
import { ActivityType } from "../../activities/activities-queue/activities-queue.constants";
import { AchievementsQueueService } from "../../achievements/achievements-queue/achievements-queue.service";
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
import { DEFAULT_ORDERING_GAP } from "../../utils/ordering";
import { Cacheable } from "../../utils/cacheable";
import { NotificationsLifecycleService } from "../../notifications/notifications-lifecycle.service";
import { deactivateStatisticsContent } from "../../statistics/statistics-target.repository";
import { randomUUID } from "node:crypto";
import { ImporterResponseItemDto } from "../../importer/dto/importer-response-item.dto";
import { UserGameCover } from "../../game/game-cover/entities/user-game-cover.entity";
import { LibraryAccessService } from "../../libraries/library-access.service";
import {
    LIBRARY_VISIBILITY_RANK,
    LibraryAccess,
    LibraryVisibility,
} from "../../libraries/library-visibility.constants";
import { normalizeGameSearchQuery } from "../../search/search.service";

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
        @InjectRepository(UserGameCover)
        private userGameCoverRepository: Repository<UserGameCover>,
        @Optional()
        @Inject(NotificationsLifecycleService)
        private readonly notificationsLifecycleService:
            | NotificationsLifecycleService
            | undefined,
        private readonly libraryAccessService: LibraryAccessService,
    ) {}

    async findOneById(id: string) {
        return await this.collectionEntriesRepository.findOne({
            where: {
                id,
            },
            relations: this.relations,
        });
    }

    async findOneByIdForViewer(viewerId: string | undefined, id: string) {
        const { entry, access } = await this.resolveEntryForViewer(
            viewerId,
            id,
        );
        return this.redactEntriesForViewer(
            [entry],
            viewerId,
            access.canViewLibrary,
        )[0];
    }

    async findRelatedEntries(
        collectionEntryId: string,
    ): Promise<FindRelatedCollectionEntriesResponseDto> {
        return this.findRelatedEntriesOf(
            await this.findOneByIdOrFail(collectionEntryId),
        );
    }

    async findRelatedEntriesForViewer(
        viewerId: string | undefined,
        collectionEntryId: string,
    ): Promise<FindRelatedCollectionEntriesResponseDto> {
        const { entry, access } = await this.resolveEntryForViewer(
            viewerId,
            collectionEntryId,
        );
        return this.findRelatedEntriesOf(entry, access.visibleEntryLevels);
    }

    private async findRelatedEntriesOf(
        entry: CollectionEntry,
        visibleLevels?: LibraryVisibility[],
    ): Promise<FindRelatedCollectionEntriesResponseDto> {
        const { dlcs, expansions } =
            await this.gameRepositoryService.findOneByIdOrFail(entry.gameId, {
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

        const visibleEntries = visibleLevels
            ? entriesInGameIds.filter((related) =>
                  visibleLevels.includes(related.visibility),
              )
            : entriesInGameIds;
        const mappedByGameId = toMap(visibleEntries, "gameId");

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
     * Single-entry read for a possibly different viewer: the same 404 as a missing entry when the
     * viewer may not see it.
     */
    private async resolveEntryForViewer(
        viewerId: string | undefined,
        id: string,
    ): Promise<{ entry: CollectionEntry; access: LibraryAccess }> {
        const entry = await this.findOneByIdOrFail(id);
        const access = await this.libraryAccessService.resolve(
            viewerId,
            entry.libraryUserId,
        );
        if (!access.visibleEntryLevels.includes(entry.visibility)) {
            throw new HttpException("No entry found.", HttpStatus.NOT_FOUND);
        }
        return { entry, access };
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

    async findOneByUserIdAndGameIdForViewer(
        viewerId: string | undefined,
        userId: string,
        gameId: number,
    ) {
        const entry = await this.findOneByUserIdAndGameId(userId, gameId);
        const access =
            entry && (await this.libraryAccessService.resolve(viewerId, userId));
        if (
            !entry ||
            !access ||
            !access.visibleEntryLevels.includes(entry.visibility)
        ) {
            throw new HttpException(
                "Collection entry not found.",
                HttpStatus.NOT_FOUND,
            );
        }
        return this.redactEntriesForViewer(
            [entry],
            viewerId,
            access.canViewLibrary,
        )[0];
    }

    /**
     * Drops the collections a viewer may not see from entries returned to a non-owner.
     * Returns nothing when the viewer may not see the library at all.
     */
    redactEntriesForViewer(
        entries: CollectionEntry[],
        viewerId: string | undefined,
        canViewLibrary: boolean,
    ): CollectionEntry[] {
        if (!canViewLibrary) return [];
        return entries.map((entry) => {
            if (entry.libraryUserId === viewerId || !entry.collectionsMap) {
                return entry;
            }
            entry.collectionsMap = entry.collectionsMap.filter(
                (map) => map.collection?.isPublic,
            );
            return entry;
        });
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

    /**
     * Strictly after `sinceDate`, for entries updated in the window: an entry
     * started and finished in the same window counts in both.
     */
    async countStartedAndFinishedAfter(
        userId: string,
        sinceDate: Date,
    ): Promise<{ started: number; finished: number }> {
        const row = await this.collectionEntriesRepository
            .createQueryBuilder("ce")
            .select(
                "COUNT(CASE WHEN ce.startedAt > :sinceDate THEN 1 END)",
                "started",
            )
            .addSelect(
                "COUNT(CASE WHEN ce.finishedAt > :sinceDate THEN 1 END)",
                "finished",
            )
            .where("ce.libraryUserId = :userId", { userId })
            .andWhere("ce.updatedAt >= :sinceDate", { sinceDate })
            .getRawOne<{
                started: number | string;
                finished: number | string;
            }>();

        return {
            started: Number(row?.started ?? 0),
            finished: Number(row?.finished ?? 0),
        };
    }

    private async findGameIdsWithCustomCover(userId: string) {
        // shortcut: loads all chosen IDs of the owner, replace with a join if a user reaches tens of thousands of choices.
        const choices = await this.userGameCoverRepository.find({
            select: { gameId: true },
            where: { userId },
        });
        return choices.map((choice) => choice.gameId);
    }

    private resolveLibrarySearch(
        search?: string,
    ): { empty: true } | { empty: false; gameId?: FindOperator<number> } {
        if (!search || search.trim() === "") return { empty: false };
        const normalized = normalizeGameSearchQuery(search);
        if (!normalized) return { empty: true };

        // shortcut: scans the target listing; at ≥20k entries per library, switch to an id-page query or a per-library index and revisit if p95 exceeds 200 ms.
        return {
            empty: false,
            gameId: Raw(
                (alias) =>
                    `(EXISTS (SELECT 1 FROM game g WHERE g.id = ${alias} AND g.searchName LIKE :librarySearch) OR EXISTS (SELECT 1 FROM game_alternative_name a WHERE a.gameId = ${alias} AND a.searchName LIKE :librarySearch))`,
                { librarySearch: `%${normalized}%` },
            ),
        };
    }

    private combineGameIdConditions(
        ...conditions: (FindOperator<number> | undefined)[]
    ) {
        const defined = conditions.filter(
            (condition): condition is FindOperator<number> =>
                condition !== undefined,
        );
        return defined.length > 1 ? And(...defined) : defined[0];
    }

    async findAllByCollectionIdWithPermissions(
        userId: string | undefined,
        collectionId: string,
        dto?: FindCollectionEntriesForCollectionIdDto,
    ): Promise<[CollectionEntry[], number]> {
        const searchFilter = this.resolveLibrarySearch(dto?.search);
        if (searchFilter.empty) return [[], 0];

        const baseFindOptions = buildBaseFindOptions<CollectionEntry>({
            ...dto,
            orderBy: undefined,
        });

        const collection =
            await this.collectionsService.findOneById(collectionId);
        if (!collection) {
            return [[], 0];
        }
        const access = await this.libraryAccessService.resolve(
            userId,
            collection.libraryUserId,
        );
        const isOwner = collection.libraryUserId === userId;
        if (!isOwner && (!collection.isPublic || !access.canViewLibrary)) {
            return [[], 0];
        }

        let customCoverGameIds: number[] | undefined;
        if (dto?.hasCustomCover) {
            customCoverGameIds = await this.findGameIdsWithCustomCover(
                collection.libraryUserId,
            );
            if (customCoverGameIds.length === 0) {
                return [[], 0];
            }
        }

        const findOptions: FindManyOptions<CollectionEntry> = {
            ...baseFindOptions,
            where: {
                collectionsMap: {
                    collection: {
                        id: collectionId,
                    },
                },
                visibility: In(access.visibleEntryLevels),
                gameId: this.combineGameIdConditions(
                    customCoverGameIds ? In(customCoverGameIds) : undefined,
                    searchFilter.gameId,
                ),
                game: buildGameFilterFindOptions(dto?.gameFilters),
            },
            order: {
                game: {
                    firstReleaseDate: dto?.orderBy?.releaseDate,
                },
                collectionsMap: {
                    order: dto?.orderBy?.userCustom,
                    createdAt: dto?.orderBy?.addedDate,
                },
            },
            relations: this.relations,
        };

        const [entries, total] =
            await this.collectionEntriesRepository.findAndCount(findOptions);
        return [
            this.redactEntriesForViewer(
                entries,
                userId,
                access.canViewLibrary,
            ),
            total,
        ];
    }

    async findAllByUserIdWithPermissions(
        userId: string | undefined,
        targetUserId: string,
        dto: FindCollectionEntriesDto,
    ): Promise<[CollectionEntry[], number]> {
        const searchFilter = this.resolveLibrarySearch(dto?.search);
        if (searchFilter.empty) return [[], 0];

        const access = await this.libraryAccessService.resolve(
            userId,
            targetUserId,
        );
        if (!access.canViewLibrary) return [[], 0];

        const findOptions = buildBaseFindOptions({
            ...dto,
            orderBy: undefined,
        });

        let customCoverGameIds: number[] | undefined;
        if (dto.hasCustomCover) {
            customCoverGameIds = await this.findGameIdsWithCustomCover(
                targetUserId,
            );
            if (customCoverGameIds.length === 0) {
                return [[], 0];
            }
        }

        const [entries, total] =
            await this.collectionEntriesRepository.findAndCount({
                ...findOptions,
                where: {
                    libraryUserId: targetUserId,
                    visibility: In(access.visibleEntryLevels),
                    status: dto.status,
                    gameId: this.combineGameIdConditions(
                        customCoverGameIds ? In(customCoverGameIds) : undefined,
                        searchFilter.gameId,
                    ),
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
        return [
            this.redactEntriesForViewer(
                entries,
                userId,
                access.canViewLibrary,
            ),
            total,
        ];
    }

    /**
     * Find all entries created or played in the period, even if edited later.
     * @param userId
     * @param period
     */
    async findAllByUserIdInPeriod(
        userId: string,
        period: { startDate: Date; endDate: Date },
    ) {
        return this.collectionEntriesRepository.find({
            where: [
                {
                    libraryUserId: userId,
                    createdAt: Between(period.startDate, period.endDate),
                },
                {
                    libraryUserId: userId,
                    startedAt: Between(period.startDate, period.endDate),
                },
                {
                    libraryUserId: userId,
                    finishedAt: Between(period.startDate, period.endDate),
                },
                {
                    libraryUserId: userId,
                    droppedAt: Between(period.startDate, period.endDate),
                },
                {
                    libraryUserId: userId,
                    plannedAt: Between(period.startDate, period.endDate),
                },
            ],
            relations: this.relations,
        });
    }

    async findFavoritesByUserId(
        userId: string | undefined,
        targetUserId: string,
        dto: FindCollectionEntriesDto,
    ): Promise<[CollectionEntry[], number]> {
        const searchFilter = this.resolveLibrarySearch(dto?.search);
        if (searchFilter.empty) return [[], 0];

        const access = await this.libraryAccessService.resolve(
            userId,
            targetUserId,
        );
        if (!access.canViewLibrary) return [[], 0];

        const findOptions = buildBaseFindOptions({
            ...dto,
            orderBy: undefined,
        });

        let customCoverGameIds: number[] | undefined;
        if (dto.hasCustomCover) {
            customCoverGameIds = await this.findGameIdsWithCustomCover(
                targetUserId,
            );
            if (customCoverGameIds.length === 0) {
                return [[], 0];
            }
        }

        const [entries, total] =
            await this.collectionEntriesRepository.findAndCount({
                ...findOptions,
                where: {
                    isFavorite: true,
                    libraryUserId: targetUserId,
                    visibility: In(access.visibleEntryLevels),
                    status: dto.status,
                    gameId: this.combineGameIdConditions(
                        customCoverGameIds ? In(customCoverGameIds) : undefined,
                        searchFilter.gameId,
                    ),
                },
                order: {
                    createdAt: dto?.orderBy?.addedDate,
                    game: {
                        firstReleaseDate: dto?.orderBy?.releaseDate,
                    },
                },
                relations: this.relations,
            });
        return [
            this.redactEntriesForViewer(
                entries,
                userId,
                access.canViewLibrary,
            ),
            total,
        ];
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
        createOnly = false,
    ) {
        const {
            collectionIds,
            gameId,
            platformIds,
            finishedAt,
            status,
            relatedGameIds,
            visibility,
        } = createEntryDto;

        const uniqueCollectionIds = Array.from(new Set(collectionIds));
        const uniquePlatformIds = Array.from(new Set(platformIds));

        if (uniquePlatformIds.length === 0) {
            throw new HttpException(
                "At least one platform id must be informed",
                HttpStatus.BAD_REQUEST,
            );
        }

        const ownedPlatforms = uniquePlatformIds.map((id) => ({
            id: id,
        }));

        // Serialize creation across import/manual callers; user/game has no unique constraint.
        const library = await this.collectionEntriesRepository.manager
            .getRepository(Library)
            .findOne({
                where: { userId },
                lock: { mode: "pessimistic_write" },
            });
        if (!library)
            throw new HttpException("Library not found", HttpStatus.NOT_FOUND);

        const inferredStatusAndDates = await this.inferStatusAndAssociatedDates(
            userId,
            uniqueCollectionIds,
            status,
            finishedAt,
        );

        const possibleExistingEntry = await this.findOneByUserIdAndGameId(
            userId,
            gameId,
        );

        if (createOnly && possibleExistingEntry) return false;

        const updatedPartialEntity: DeepPartial<CollectionEntry> = {
            ...possibleExistingEntry,
            libraryUserId: userId,
            finishedAt,
            gameId,
            // Updated automatically with @ManyToMany
            ownedPlatforms,
            visibility:
                visibility ??
                possibleExistingEntry?.visibility ??
                LibraryVisibility.Public,
            ...inferredStatusAndDates,
        };

        const upsertedEntry =
            await this.collectionEntriesRepository.save(updatedPartialEntity);

        if (
            possibleExistingEntry &&
            LIBRARY_VISIBILITY_RANK[updatedPartialEntity.visibility!] >
                LIBRARY_VISIBILITY_RANK[possibleExistingEntry.visibility]
        ) {
            await this.notificationsLifecycleService?.invalidateLibraryContent(
                userId,
                upsertedEntry.id,
            );
        }

        await this.updateAssociatedCollections(
            upsertedEntry.id,
            uniqueCollectionIds,
        );

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

        for (const metric of ["library_games", "games_finished"]) {
            this.achievementsQueueService.addTrackingJob({ userId, metric });
        }
    }

    @Transactional()
    async createForImport(
        userId: string,
        gameId: number,
        platformId: number,
        collectionId?: string | null,
    ) {
        const destination = collectionId
            ? await this.collectionsService.findOneById(collectionId)
            : null;
        if (destination && destination.libraryUserId !== userId)
            throw new HttpException(
                "Automatic-import collection does not belong to this user",
                HttpStatus.FORBIDDEN,
            );
        const created = await this.createOrUpdate(
            userId,
            {
                collectionIds: destination ? [destination.id] : [],
                gameId,
                platformIds: [platformId],
                status: CollectionEntryStatus.PLANNED,
                finishedAt: null,
            },
            true,
        );
        return created === false ? ("skipped" as const) : ("imported" as const);
    }

    async createMissingForBatch(
        userId: string,
        candidates: ImporterResponseItemDto[],
        status: CollectionEntryStatus,
        collectionIds: string[],
    ) {
        if (!candidates.length) return [];
        const existing = await this.collectionEntriesRepository.find({
            select: { gameId: true },
            where: {
                libraryUserId: userId,
                gameId: In(candidates.map((candidate) => candidate.gameId)),
            },
        });
        const existingIds = new Set(existing.map((entry) => entry.gameId));
        const missing = candidates.filter(
            (candidate) => !existingIds.has(candidate.gameId),
        );
        if (!missing.length) return [];
        const dates = await this.inferStatusAndAssociatedDates(
            userId,
            [],
            status,
            null,
        );
        const entries = missing.map((candidate) => ({
            id: randomUUID(),
            libraryUserId: userId,
            gameId: candidate.gameId,
            ...dates,
        }));
        const manager = this.collectionEntriesRepository.manager;
        const junction =
            this.collectionEntriesRepository.metadata.relations.find(
                (relation) => relation.propertyName === "ownedPlatforms",
            )!.junctionEntityMetadata!.tableName;
        for (let offset = 0; offset < entries.length; offset += 500) {
            const page = entries.slice(offset, offset + 500);
            await this.collectionEntriesRepository.insert(page);
            await manager
                .createQueryBuilder()
                .insert()
                .into(junction)
                .values(
                    page.map((entry, index) => ({
                        collectionEntryId: entry.id,
                        gamePlatformId:
                            missing[offset + index].preferredPlatformId,
                    })),
                )
                .execute();
        }
        if (collectionIds.length) {
            const orders = await this.collectionEntryToCollectionRepository
                .createQueryBuilder("map")
                .select("map.collectionId", "collectionId")
                .addSelect("MAX(map.order)", "maxOrder")
                .where("map.collectionId IN (:...collectionIds)", {
                    collectionIds,
                })
                .groupBy("map.collectionId")
                .getRawMany<{ collectionId: string; maxOrder: number }>();
            const maxOrders = new Map(
                orders.map((row) => [row.collectionId, Number(row.maxOrder)]),
            );
            const maps = entries.flatMap((entry, index) =>
                collectionIds.map((collectionId) => ({
                    collectionEntryId: entry.id,
                    collectionId,
                    order:
                        (maxOrders.get(collectionId) ?? 0) +
                        (index + 1) * DEFAULT_ORDERING_GAP,
                })),
            );
            for (let offset = 0; offset < maps.length; offset += 500)
                await this.collectionEntryToCollectionRepository.insert(
                    maps.slice(offset, offset + 500),
                );
        }
        return entries;
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
            const newOrder = lastOrder + DEFAULT_ORDERING_GAP;

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
     * Also rejects collection ids (unique) that don't exist or belong to another user.
     * @private
     */
    private async inferStatusAndAssociatedDates(
        userId: string,
        collectionIds: string[],
        status: CollectionEntryStatus,
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

        if (
            associatedCollections.length !== collectionIds.length ||
            associatedCollections.some(
                (collection) => collection.libraryUserId !== userId,
            )
        ) {
            throw new HttpException(
                "Collection does not belong to this user.",
                HttpStatus.FORBIDDEN,
            );
        }

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
                startedAt: null,
                finishedAt: null,
                droppedAt: null,
            }))
            .with(CollectionEntryStatus.PLAYING, () => ({
                status: CollectionEntryStatus.PLAYING,
                startedAt: new Date(),
                finishedAt: null,
                droppedAt: null,
            }))
            .with(CollectionEntryStatus.DROPPED, () => ({
                status: CollectionEntryStatus.DROPPED,
                droppedAt: new Date(),
                finishedAt: null,
            }))
            .with(CollectionEntryStatus.FINISHED, () => ({
                status: CollectionEntryStatus.FINISHED,
                finishedAt: finishedAt ?? new Date(),
                droppedAt: null,
            }))
            .with(CollectionEntryStatus.ONGOING, () => ({
                status: CollectionEntryStatus.ONGOING,
                startedAt: new Date(),
                finishedAt: null,
                droppedAt: null,
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
                visibility: parentEntry.visibility,
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
     * Changes the visibility of one entry. Touches no activity, level or achievement.
     */
    async changeVisibility(
        userId: string,
        gameId: number,
        visibility: LibraryVisibility,
    ) {
        const entity = await this.findOneByUserIdAndGameIdOrFail(
            userId,
            gameId,
        );
        if (entity.visibility === visibility) return;

        await this.collectionEntriesRepository.update(
            { id: entity.id },
            { visibility },
        );

        if (
            LIBRARY_VISIBILITY_RANK[visibility] >
            LIBRARY_VISIBILITY_RANK[entity.visibility]
        ) {
            await this.notificationsLifecycleService?.invalidateLibraryContent(
                userId,
                entity.id,
            );
        }
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

        await this.collectionEntriesRepository.manager.transaction(
            async (manager) => {
                for (const type of ["review", "activity"] as const) {
                    const sources = await manager.query(
                        `SELECT id FROM ${type} WHERE collectionEntryId = ? ORDER BY id FOR UPDATE`,
                        [entry.id],
                    );
                    for (const source of sources) {
                        await this.notificationsLifecycleService?.invalidateContent(
                            type,
                            source.id,
                            manager,
                        );
                        await deactivateStatisticsContent(
                            manager,
                            type,
                            source.id,
                        );
                    }
                }
                await manager.getRepository(CollectionEntry).delete(entry.id);
            },
        );
    }

    async findIconsForOwnedPlatforms(entryId: string) {
        return this.iconsForOwnedPlatforms(await this.findOneByIdOrFail(entryId));
    }

    async findIconsForOwnedPlatformsForViewer(
        viewerId: string | undefined,
        entryId: string,
    ) {
        const { entry } = await this.resolveEntryForViewer(viewerId, entryId);
        return this.iconsForOwnedPlatforms(entry);
    }

    private iconsForOwnedPlatforms(entry: CollectionEntry) {
        const ownedPlatforms = entry.ownedPlatforms;
        if (ownedPlatforms.length === 0) return [];
        const abbreviations = ownedPlatforms.map(
            (platform) => platform.abbreviation,
        );
        return getIconNamesForPlatformAbbreviations(abbreviations);
    }
}
