import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
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
import { HttpStatusCode } from "axios";
import { ImporterResponseItemDto } from "./dto/importer-response-item.dto";
import { ExternalGameService } from "../game/external-game/external-game.service";
import { XboxSyncService } from "../sync/xbox/xbox-sync.service";
import { toMap } from "../utils/toMap";
import { ImporterSearchService } from "./importer-search/importer-search.service";

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
    ) {}

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

        const ignoredExternalGamesIds = processedEntries.map((entry) => {
            return entry.gameExternalGameId;
        });

        const userConnection =
            await this.connectionsService.findOneByUserIdAndTypeOrFail(
                userId,
                EConnectionType.STEAM,
            );

        if (!userConnection.isImporterEnabled) {
            throw new HttpException(
                "Steam connection importing is disabled.",
                HttpStatus.PRECONDITION_FAILED,
            );
        }

        const games = await this.steamSyncService.getAllGames(
            userConnection.sourceUserId,
        );

        const gamesUids = games.map((item) => `${item.game.id}`);

        const externalGames =
            await this.externalGameService.getExternalGamesForSourceIds(
                gamesUids,
                EGameExternalGameCategory.Steam,
            );

        const filteredGames = externalGames.filter(
            (externalGame) =>
                !ignoredExternalGamesIds.includes(externalGame.id),
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

        const ignoredExternalGamesIds = processedEntries.map((entry) => {
            return entry.gameExternalGameId;
        });

        const userConnection =
            await this.connectionsService.findOneByUserIdAndTypeOrFail(
                userId,
                EConnectionType.PSN,
            );

        if (!userConnection.isImporterEnabled) {
            throw new HttpException(
                "Steam connection importing is disabled.",
                HttpStatus.PRECONDITION_FAILED,
            );
        }

        const games = await this.psnSyncService.getAllGames(
            userConnection.sourceUserId,
        );

        if (games.length === 0) {
            throw new HttpException(
                "No games found. PSN may be unavailable or user's profile is set to private.",
                HttpStatusCode.BadRequest,
            );
        }

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
            (externalGame) =>
                !ignoredExternalGamesIds.includes(externalGame.id),
        );

        return filteredGames.map((item): ImporterResponseItemDto => {
            const relatedOriginalGame = games.find(
                (game) => `${game.concept.id}` === item.uid,
            )!;

            /*
             * @see GamePlatform#id
             */
            let targetPlatformId: number;
            switch (relatedOriginalGame.category) {
                case "ps4_game":
                    // ps4 platform id
                    targetPlatformId = 48;
                    break;
                case "ps5_game":
                    // ps5 platform id
                    targetPlatformId = 167;
                    break;
                default:
                    // ps4 platform id
                    targetPlatformId = 48;
                    break;
            }

            return {
                ...item,
                preferredPlatformId: targetPlatformId,
            };
        });
    }

    public async findUnprocessedXboxEntries(userId: string) {
        const processedEntries = await this.getProcessedEntries(userId);

        const ignoredExternalGamesIds = processedEntries.map((entry) => {
            return entry.gameExternalGameId;
        });

        const userConnection =
            await this.connectionsService.findOneByUserIdAndTypeOrFail(
                userId,
                EConnectionType.XBOX,
            );

        if (!userConnection.isImporterEnabled) {
            throw new HttpException(
                "Steam connection importing is disabled.",
                HttpStatus.PRECONDITION_FAILED,
            );
        }

        const allGames = await this.xboxSyncService.getAllGames(
            userConnection.sourceUserId,
        );

        const sourceUids = allGames.map((game) => game.productId);

        const externalGames =
            await this.externalGameService.getExternalGamesForSourceIds(
                sourceUids,
                EGameExternalGameCategory.Microsoft,
            );

        const filteredGames = externalGames.filter(
            (externalGame) =>
                !ignoredExternalGamesIds.includes(externalGame.id),
        );

        return filteredGames.map((externalGame): ImporterResponseItemDto => {
            const relatedOriginalGame = allGames.find(
                (game) => game.productId === externalGame.uid,
            )!;

            /*
             * @see GamePlatform#id
             */
            let targetPlatformId: number;
            if (relatedOriginalGame.mediaItemType === "Xbox360Game") {
                targetPlatformId = 12;
            } else if (relatedOriginalGame.devices.includes("XboxSeries")) {
                targetPlatformId = 169;
            } else {
                targetPlatformId = 49;
            }

            return {
                ...externalGame,
                preferredPlatformId: targetPlatformId,
            };
        });
    }

    public async findUnprocessedEntries(
        userId: string,
        source: EImporterSource,
        dto: ImporterUnprocessedRequestDto,
    ): Promise<TPaginationData<ImporterResponseItemDto>> {
        let entries: ImporterResponseItemDto[] = [];
        switch (source) {
            case EImporterSource.STEAM:
                entries = await this.findUnprocessedSteamEntries(userId);
                break;
            case EImporterSource.PSN:
                entries = await this.findUnprocessedPsnEntries(userId);
                break;
            case EImporterSource.XBOX:
                entries = await this.findUnprocessedXboxEntries(userId);
                break;
            default:
                throw new HttpException(
                    "Importer source not available",
                    HttpStatus.BAD_REQUEST,
                );
        }

        if (entries.length === 0) {
            throw new HttpException(
                "No unprocessed entries found",
                HttpStatus.NOT_FOUND,
            );
        }

        const uniqueEntriesMap = toMap(entries, "gameId");
        const uniqueEntries = Array.from(uniqueEntriesMap.values());

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
