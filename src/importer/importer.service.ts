import { PlayerSyncWrite } from "../sync/player-sync-attempt";
import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { ConnectionProviderRegistry } from "../connection/connection-provider.registry";
import { InjectRepository } from "@nestjs/typeorm";
import { ImporterProcessedEntry } from "./entity/importer-processed-entry.entity";
import { Repository } from "typeorm";
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
    ) {
        providerRegistry.registerSyncHandlers(EConnectionType.STEAM, {
            fetchLibraryGames: (userId) =>
                this.findUnprocessedSteamEntries(userId),
        });
        providerRegistry.registerSyncHandlers(EConnectionType.PSN, {
            fetchLibraryGames: (userId) =>
                this.findUnprocessedPsnEntries(userId),
        });
        providerRegistry.registerSyncHandlers(EConnectionType.XBOX, {
            fetchLibraryGames: (userId) =>
                this.findUnprocessedXboxEntries(userId),
        });
    }

    private async getProcessedEntries(
        userId: string,
    ): Promise<ImporterEntry[]> {
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

    private async findUnprocessedSteamEntries(userId: string) {
        const processedEntries = await this.getProcessedEntries(userId);

        const ignoredExternalGamesIds = new Set(
            processedEntries.map((entry) => entry.gameExternalGameId),
        );

        const userConnection =
            await this.connectionsService.findOneByUserIdAndTypeOrFail(
                userId,
                EConnectionType.STEAM,
            );

        const games = await this.steamSyncService.getLibraryGames(
            userConnection.sourceUserId,
        );

        const gamesUids = Array.from(
            new Set(games.map((item) => `${item.game.id}`)),
        );

        const externalGames =
            await this.externalGameService.getExternalGamesForSourceIds(
                gamesUids,
                EGameExternalGameCategory.Steam,
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

    private async findUnprocessedPsnEntries(userId: string) {
        const processedEntries = await this.getProcessedEntries(userId);

        const ignoredExternalGamesIds = new Set(
            processedEntries.map((entry) => entry.gameExternalGameId),
        );

        const userConnection =
            await this.connectionsService.findOneByUserIdAndTypeOrFail(
                userId,
                EConnectionType.PSN,
            );

        const games = await this.psnSyncService.getAllGames(
            userConnection.sourceUserId,
        );

        if (games.length === 0) return [];

        const gameUids = games.map((item) => {
            return `${item.concept.id}`;
        });

        const uniqueGameUids = Array.from(new Set(gameUids));

        const externalGames =
            await this.externalGameService.getExternalGamesForSourceIds(
                uniqueGameUids,
                EGameExternalGameCategory.PlaystationStoreUs,
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

    public async findUnprocessedXboxEntries(userId: string) {
        const processedEntries = await this.getProcessedEntries(userId);

        const ignoredExternalGamesIds = new Set(
            processedEntries.map((entry) => entry.gameExternalGameId),
        );

        const userConnection =
            await this.connectionsService.findOneByUserIdAndTypeOrFail(
                userId,
                EConnectionType.XBOX,
            );

        const allGames = await this.xboxSyncService.getAllGames(
            userConnection.sourceUserId,
        );

        const sourceUids = [...new Set(allGames.map((game) => game.productId))];

        const externalGames =
            await this.externalGameService.getExternalGamesForSourceIds(
                sourceUids,
                EGameExternalGameCategory.Microsoft,
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
        const provider = this.providerRegistry.get(source);
        const handler = provider.syncHandlers?.fetchLibraryGames;
        if (!provider.isImporterViable || !handler) {
            throw new HttpException(
                "Importer source not available",
                HttpStatus.BAD_REQUEST,
            );
        }
        const entries = await handler(userId);
        return Array.from(toMap(entries, "gameId").values());
    }

    public async findUnprocessedEntries(
        userId: string,
        source: EImporterSource,
        dto: ImporterUnprocessedRequestDto,
        afterGameId?: number,
    ): Promise<TPaginationData<ImporterResponseItemDto>> {
        const candidates = await this.findUnprocessedCandidates(userId, source);
        const uniqueEntries =
            afterGameId == null
                ? candidates
                : candidates
                      .filter((entry) => entry.gameId > afterGameId)
                      .sort((a, b) => a.gameId - b.gameId);

        const { offset, limit, search } = dto;
        const offsetToUse = offset || 0;
        const limitToUse = limit || 20;

        if (search) {
            const searchResults = await this.importerSearchService.search(
                userId,
                source,
                uniqueEntries,
                search,
            );

            return [
                searchResults.slice(offsetToUse, offsetToUse + limitToUse),
                searchResults.length,
            ];
        }

        const slicedEntries = uniqueEntries.slice(
            offsetToUse,
            offsetToUse + limitToUse,
        );

        return [slicedEntries, uniqueEntries.length];
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

    @PlayerSyncWrite()
    public async markProcessed(userId: string, externalGameId: number) {
        await this.processedEntryRepository.upsert(
            { libraryUserId: userId, gameExternalGameId: externalGameId },
            ["libraryUserId", "gameExternalGameId"],
        );
    }

    @PlayerSyncWrite()
    public async changeStatus(
        userId: string,
        dto: ImporterStatusUpdateRequestDto,
    ) {
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
