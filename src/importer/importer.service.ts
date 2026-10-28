import { PlayerSyncWrite } from "../sync/player-sync-attempt";
import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { ConnectionProviderRegistry } from "../connection/connection-provider.registry";
import { InjectRepository } from "@nestjs/typeorm";
import { ImporterProcessedEntry } from "./entity/importer-processed-entry.entity";
import { In, Repository } from "typeorm";
import { CollectionEntry } from "../collections/collections-entries/entities/collection-entry.entity";
import { Game } from "../game/game-repository/entities/game.entity";
import { ImporterIgnoredEntry } from "./entity/importer-ignored-entry.entity";
import { ConnectionsService } from "../connection/connections.service";
import { EConnectionType } from "../connection/connections.constants";
import { SteamSyncService } from "../sync/steam/steam-sync.service";
import { ImporterStatusUpdateRequestDto } from "./dto/importer-status-update-request.dto";
import { EImporterSource } from "./importer.constants";
import { EGameExternalGameCategory } from "../game/game-repository/game-repository.constants";
import { ImporterUnprocessedRequestDto } from "./dto/importer-unprocessed-request.dto";
import { TPaginationData } from "../utils/pagination/pagination-response.dto";
import { ImporterEntry } from "./entity/importer-entry.entity";
import { PsnSyncService } from "../sync/psn/psn-sync.service";
import { ImporterResponseItemDto } from "./dto/importer-response-item.dto";
import { ExternalGameService } from "../game/external-game/external-game.service";
import { XboxSyncService } from "../sync/xbox/xbox-sync.service";
import { toMap } from "../utils/toMap";
import { ImporterSearchService } from "./importer-search/importer-search.service";
import { PreferredPlatformService } from "../preferred-platform/preferred-platform.service";
import { getPreferredXboxPlatformAbbreviation } from "../sync/xbox/util/get-preferred-xbox-platform-abbreviation";
import { GameRepositoryService } from "../game/game-repository/game-repository.service";
import { getPsnPlatformAbbreviation } from "../sync/psn/util/get-psn-platform-abbreviation";
import { importerToConnectionSource } from "./importer.util";
import { ImporterBatchStatusRequestDto } from "./dto/importer-batch-status-request.dto";
import { Library } from "../libraries/entities/library.entity";
import { UserConnection } from "../connection/entity/user-connection.entity";
import { EConnectionAuthStatus } from "../connection/connections.constants";
import { Transactional } from "typeorm-transactional";

@Injectable()
export class ImporterService {
    constructor(
        @InjectRepository(ImporterProcessedEntry)
        private readonly processedEntryRepository: Repository<ImporterProcessedEntry>,
        @InjectRepository(ImporterIgnoredEntry)
        private readonly ignoredEntryRepository: Repository<ImporterIgnoredEntry>,
        private readonly importerSearchService: ImporterSearchService,
        private readonly connectionsService: ConnectionsService,
        private readonly steamSyncService: SteamSyncService,
        private readonly externalGameService: ExternalGameService,
        private readonly psnSyncService: PsnSyncService,
        private readonly xboxSyncService: XboxSyncService,
        private readonly gameRepositoryService: GameRepositoryService,
        private readonly providerRegistry: ConnectionProviderRegistry,
        @InjectRepository(CollectionEntry)
        private readonly collectionEntryRepository: Repository<CollectionEntry>,
        @InjectRepository(Game)
        private readonly gameRepository: Repository<Game>,
    ) {
        providerRegistry.registerSyncHandlers(EConnectionType.STEAM, {
            fetchLibraryGames: (userId, includeMarked, sourceUserId) =>
                this.findUnprocessedSteamEntries(
                    userId,
                    includeMarked,
                    sourceUserId,
                ),
        });
        providerRegistry.registerSyncHandlers(EConnectionType.PSN, {
            fetchLibraryGames: (userId, includeMarked, sourceUserId) =>
                this.findUnprocessedPsnEntries(
                    userId,
                    includeMarked,
                    sourceUserId,
                ),
        });
        providerRegistry.registerSyncHandlers(EConnectionType.XBOX, {
            fetchLibraryGames: (userId, includeMarked, sourceUserId) =>
                this.findUnprocessedXboxEntries(
                    userId,
                    includeMarked,
                    sourceUserId,
                ),
        });
    }

    public async getProcessedEntries(userId: string): Promise<ImporterEntry[]> {
        const [processedEntries, ignoredEntries] = await Promise.all([
            this.processedEntryRepository.findBy({
                libraryUserId: userId,
            }),
            this.ignoredEntryRepository.findBy({
                libraryUserId: userId,
            }),
        ]);

        return processedEntries.concat(ignoredEntries);
    }

    private async findUnprocessedSteamEntries(
        userId: string,
        includeMarked = false,
        sourceUserId?: string,
    ) {
        const processedEntries = includeMarked
            ? []
            : await this.getProcessedEntries(userId);

        const ignoredExternalGamesIds = new Set(
            processedEntries.map((entry) => entry.gameExternalGameId),
        );

        sourceUserId ??= (
            await this.connectionsService.findOneByUserIdAndTypeOrFail(
                userId,
                EConnectionType.STEAM,
            )
        ).sourceUserId;

        const games = await this.steamSyncService.getLibraryGames(sourceUserId);

        const gamesUids = Array.from(
            new Set(games.map((item) => `${item.game.id}`)),
        );

        const externalGames =
            await this.externalGameService.getExternalGamesForSourceIds(
                gamesUids,
                EGameExternalGameCategory.Steam,
                includeMarked,
            );

        const filteredGames = externalGames.filter(
            (externalGame) => !ignoredExternalGamesIds.has(externalGame.id),
        );

        return filteredGames.map(
            (item): ImporterResponseItemDto => ({
                ...item,
                /* PC platform ID
                 * @see GamePlatform#id
                 */
                preferredPlatformId: 6,
            }),
        );
    }

    private async findUnprocessedPsnEntries(
        userId: string,
        includeMarked = false,
        sourceUserId?: string,
    ) {
        const processedEntries = includeMarked
            ? []
            : await this.getProcessedEntries(userId);

        const ignoredExternalGamesIds = new Set(
            processedEntries.map((entry) => entry.gameExternalGameId),
        );

        sourceUserId ??= (
            await this.connectionsService.findOneByUserIdAndTypeOrFail(
                userId,
                EConnectionType.PSN,
            )
        ).sourceUserId;

        const games = await this.psnSyncService.getAllGames(sourceUserId);

        if (games.length === 0) return [];

        const gameUids = games.map((item) => {
            return `${item.concept.id}`;
        });

        const uniqueGameUids = Array.from(new Set(gameUids));

        const externalGames =
            await this.externalGameService.getExternalGamesForSourceIds(
                uniqueGameUids,
                EGameExternalGameCategory.PlaystationStoreUs,
                includeMarked,
            );

        const filteredGames = externalGames.filter(
            (externalGame) => !ignoredExternalGamesIds.has(externalGame.id),
        );

        const platformsMap =
            await this.gameRepositoryService.getGamePlatformsMap(
                "abbreviation",
            );

        const gamesByConcept = new Map(
            [...Map.groupBy(games, (game) => String(game.concept.id))].map(
                ([id, games]) => [id, games[0]],
            ),
        );
        return filteredGames.map((item): ImporterResponseItemDto => {
            const relatedOriginalGame = gamesByConcept.get(item.uid)!;

            const preferredPlatformAbbreviation = getPsnPlatformAbbreviation(
                relatedOriginalGame.category,
            );

            const preferredPlatform = platformsMap.get(
                preferredPlatformAbbreviation,
            )!;

            return {
                ...item,
                preferredPlatformId: preferredPlatform.id,
            };
        });
    }

    public async findUnprocessedXboxEntries(
        userId: string,
        includeMarked = false,
        sourceUserId?: string,
    ) {
        const processedEntries = includeMarked
            ? []
            : await this.getProcessedEntries(userId);

        const ignoredExternalGamesIds = new Set(
            processedEntries.map((entry) => entry.gameExternalGameId),
        );

        sourceUserId ??= (
            await this.connectionsService.findOneByUserIdAndTypeOrFail(
                userId,
                EConnectionType.XBOX,
            )
        ).sourceUserId;

        const allGames = await this.xboxSyncService.getAllGames(sourceUserId);

        const sourceUids = [...new Set(allGames.map((game) => game.productId))];

        const externalGames =
            await this.externalGameService.getExternalGamesForSourceIds(
                sourceUids,
                EGameExternalGameCategory.Microsoft,
                includeMarked,
            );

        const filteredGames = externalGames.filter(
            (externalGame) => !ignoredExternalGamesIds.has(externalGame.id),
        );

        const platformsMap =
            await this.gameRepositoryService.getGamePlatformsMap(
                "abbreviation",
            );

        const gamesByProduct = new Map(
            [...Map.groupBy(allGames, (game) => game.productId)].map(
                ([id, games]) => [id, games[0]],
            ),
        );
        return filteredGames.map((externalGame): ImporterResponseItemDto => {
            const relatedOriginalGame = gamesByProduct.get(externalGame.uid)!;
            const deviceTitles = relatedOriginalGame.devices.flat(1);

            const targetPlatformAbbreviation =
                getPreferredXboxPlatformAbbreviation(deviceTitles);

            const preferredPlatform = platformsMap.get(
                targetPlatformAbbreviation,
            )!;

            return {
                ...externalGame,
                preferredPlatformId: preferredPlatform.id,
            };
        });
    }

    public async findUnprocessedCandidates(
        userId: string,
        source: EImporterSource,
    ): Promise<ImporterResponseItemDto[]> {
        const entries = await this.findProviderCandidates(userId, source);
        return Array.from(toMap(entries, "gameId").values());
    }

    public async findProviderCandidates(
        userId: string,
        source: EImporterSource,
        includeMarked = false,
        sourceUserId?: string,
    ): Promise<ImporterResponseItemDto[]> {
        const provider = this.providerRegistry.get(source);
        const handler = provider.syncHandlers?.fetchLibraryGames;
        if (!provider.isImporterViable || !handler) {
            throw new HttpException(
                "Importer source not available",
                HttpStatus.BAD_REQUEST,
            );
        }
        return includeMarked || sourceUserId !== undefined
            ? handler(userId, includeMarked, sourceUserId)
            : handler(userId);
    }

    public async findProviderSnapshot(userId: string, source: EImporterSource) {
        const provider = this.providerRegistry.get(source);
        if (
            !provider.isImporterViable ||
            !provider.syncHandlers?.fetchLibraryGames
        )
            throw new HttpException(
                "Importer source not available",
                HttpStatus.BAD_REQUEST,
            );
        const connection =
            await this.connectionsService.findOneByUserIdAndTypeOrFail(
                userId,
                importerToConnectionSource(source),
            );
        const candidates = await this.findProviderCandidates(
            userId,
            source,
            true,
            connection.sourceUserId,
        );
        return { connection, candidates };
    }

    public validateCandidateIds(
        candidates: ImporterResponseItemDto[],
        ids: number[],
    ) {
        const byId = new Map(
            candidates.map((candidate) => [String(candidate.id), candidate]),
        );
        return [...new Set(ids)].map((id) => {
            const candidate = byId.get(String(id));
            if (!candidate)
                throw new HttpException(
                    "Invalid importer candidate",
                    HttpStatus.BAD_REQUEST,
                );
            return candidate;
        });
    }

    public async findUnprocessedEntries(
        userId: string,
        source: EImporterSource,
        dto: ImporterUnprocessedRequestDto,
        afterGameId?: number,
    ): Promise<TPaginationData<ImporterResponseItemDto>> {
        const candidates = await this.findUnprocessedCandidates(userId, source);
        let uniqueEntries =
            afterGameId == null
                ? candidates
                : candidates
                      .filter((entry) => entry.gameId > afterGameId)
                      .sort((a, b) => a.gameId - b.gameId);

        const libraryEntries = uniqueEntries.length
            ? await this.collectionEntryRepository.find({
                  select: { gameId: true },
                  where: {
                      libraryUserId: userId,
                      gameId: In(uniqueEntries.map((entry) => entry.gameId)),
                  },
              })
            : [];
        const libraryGameIds = new Set(
            libraryEntries.map((entry) => entry.gameId),
        );
        if (dto.excludeInLibrary) {
            uniqueEntries = uniqueEntries.filter(
                (entry) => !libraryGameIds.has(entry.gameId),
            );
        }
        const { offset, limit, search } = dto;
        const offsetToUse = offset || 0;
        const limitToUse = limit || 20;

        if (search) {
            uniqueEntries = await this.importerSearchService.search(
                userId,
                source,
                uniqueEntries,
                search,
            );
        }

        const slicedEntries = uniqueEntries.slice(
            offsetToUse,
            offsetToUse + limitToUse,
        );

        const games = slicedEntries.length
            ? await this.gameRepository.find({
                  where: { id: In(slicedEntries.map((entry) => entry.gameId)) },
                  relations: { cover: true },
              })
            : [];
        const gamesById = new Map(games.map((game) => [game.id, game]));
        return [
            slicedEntries.map((entry) => ({
                ...entry,
                game: gamesById.get(entry.gameId)!,
                isInLibrary: libraryGameIds.has(entry.gameId),
            })),
            uniqueEntries.length,
        ];
    }

    public async isProcessedOrIgnored(userId: string, externalGameId: number) {
        const where = {
            libraryUserId: userId,
            gameExternalGameId: externalGameId,
        };
        return (
            (await this.processedEntryRepository.existsBy(where)) ||
            (await this.ignoredEntryRepository.existsBy(where))
        );
    }

    public async lockLibrary(userId: string) {
        const library = await this.processedEntryRepository.manager
            .getRepository(Library)
            .findOne({
                where: { userId },
                lock: { mode: "pessimistic_write" },
            });
        if (!library)
            throw new HttpException("Library not found", HttpStatus.NOT_FOUND);
    }

    public async changeStatusBatch(
        userId: string,
        dto: ImporterBatchStatusRequestDto,
    ) {
        const snapshot = await this.findProviderSnapshot(userId, dto.source);
        const candidates = this.validateCandidateIds(
            snapshot.candidates,
            dto.externalGameIds,
        );
        return this.commitStatusBatch(
            userId,
            snapshot.connection,
            candidates,
            dto.status,
        );
    }

    @Transactional()
    private async commitStatusBatch(
        userId: string,
        snapshot: { id: number; sourceUserId: string; type: EConnectionType },
        candidates: ImporterResponseItemDto[],
        status: "processed" | "ignored",
    ) {
        const connection = await this.processedEntryRepository.manager
            .getRepository(UserConnection)
            .findOne({
                where: {
                    id: snapshot.id,
                    profileUserId: userId,
                    type: snapshot.type,
                },
                lock: { mode: "pessimistic_write" },
            });
        if (
            !connection ||
            connection.sourceUserId !== snapshot.sourceUserId ||
            connection.authStatus === EConnectionAuthStatus.REAUTH_REQUIRED
        )
            throw new HttpException(
                "Connection changed during import",
                HttpStatus.CONFLICT,
            );
        await this.lockLibrary(userId);
        const ids = candidates.map((candidate) => candidate.id);
        const target =
            status === "ignored"
                ? this.ignoredEntryRepository
                : this.processedEntryRepository;
        const opposite =
            status === "ignored"
                ? this.processedEntryRepository
                : this.ignoredEntryRepository;
        const where = { libraryUserId: userId, gameExternalGameId: In(ids) };
        const [existing, conflicting] = await Promise.all([
            target.findBy(where),
            opposite.findBy(where),
        ]);
        if (conflicting.length)
            throw new HttpException(
                "Candidate has opposite status",
                HttpStatus.CONFLICT,
            );
        const existingIds = new Set(
            existing.map((entry) => String(entry.gameExternalGameId)),
        );
        const rows = ids
            .filter((id) => !existingIds.has(String(id)))
            .map((id) => ({ libraryUserId: userId, gameExternalGameId: id }));
        if (rows.length) await target.insert(rows);
    }

    @PlayerSyncWrite()
    @Transactional()
    public async markProcessed(userId: string, externalGameId: number) {
        await this.lockLibrary(userId);
        await this.processedEntryRepository.upsert(
            { libraryUserId: userId, gameExternalGameId: externalGameId },
            ["libraryUserId", "gameExternalGameId"],
        );
    }

    @PlayerSyncWrite()
    @Transactional()
    public async changeStatus(
        userId: string,
        dto: ImporterStatusUpdateRequestDto,
    ) {
        await this.lockLibrary(userId);
        const targetRepository =
            dto.status === "ignored"
                ? this.ignoredEntryRepository
                : this.processedEntryRepository;

        const alreadyExists = await targetRepository.existsBy({
            gameExternalGameId: dto.externalGameId,
            libraryUserId: userId,
        });
        if (alreadyExists) {
            throw new HttpException(
                `Item is already on user's ${dto.status} list`,
                HttpStatus.BAD_REQUEST,
            );
        }

        await targetRepository.save({
            libraryUserId: userId,
            gameExternalGameId: dto.externalGameId,
        });
    }
}
