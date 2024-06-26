import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ImporterProcessedEntry } from "./entity/importer-processed-entry.entity";
import { Repository } from "typeorm";
import { ImporterIgnoredEntry } from "./entity/importer-ignored-entry.entity";
import { ConnectionsService } from "../connections/connections.service";
import { EConnectionType } from "../connections/connections.constants";
import { SteamSyncService } from "../sync/steam/steam-sync.service";
import { GameRepositoryService } from "../game/game-repository/game-repository.service";
import { ImporterStatusUpdateRequestDto } from "./dto/importer-status-update-request.dto";
import { EImporterSource } from "./importer.constants";
import { EGameExternalGameCategory } from "../game/game-repository/game-repository.constants";
import { Cache, CACHE_MANAGER } from "@nestjs/cache-manager";
import { GameExternalGame } from "../game/game-repository/entities/game-external-game.entity";
import { ImporterUnprocessedRequestDto } from "./dto/importer-unprocessed-request.dto";
import { TPaginationData } from "../utils/pagination/pagination-response.dto";
import { ImporterEntry } from "./entity/importer-entry.entity";

@Injectable()
export class ImporterService {
    constructor(
        @InjectRepository(ImporterProcessedEntry)
        private readonly processedEntryRepository: Repository<ImporterProcessedEntry>,
        @InjectRepository(ImporterIgnoredEntry)
        private readonly ignoredEntryRepository: Repository<ImporterIgnoredEntry>,
        @Inject(CACHE_MANAGER)
        private readonly cacheManager: Cache,
        private readonly connectionsService: ConnectionsService,
        private readonly steamSyncService: SteamSyncService,
        private readonly gameRepositoryService: GameRepositoryService,
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
                EConnectionType.Steam,
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
            await this.gameRepositoryService.getExternalGamesForSourceIds(
                gamesUids,
                EGameExternalGameCategory.Steam,
            );

        return externalGames.filter(
            (externalGame) =>
                !ignoredExternalGamesIds.includes(externalGame.id),
        );
    }

    public async findUnprocessedEntries(
        userId: string,
        source: EImporterSource,
        dto: ImporterUnprocessedRequestDto,
    ): Promise<TPaginationData<GameExternalGame>> {
        let entries: GameExternalGame[] = [];
        switch (source) {
            case EImporterSource.STEAM:
                entries = await this.findUnprocessedSteamEntries(userId);
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

        const { offset, limit } = dto;
        const offsetToUse = offset || 0;
        const limitToUse = limit || 20;

        const slicedEntries = entries.slice(
            offsetToUse,
            offsetToUse + limitToUse,
        );

        return [slicedEntries, entries.length];
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
