import { GameAchievementSyncQueueService } from "./sync/game-achievement-sync-queue.service";
import { playerSyncWrite } from "../../sync/player-sync-attempt";
import { InjectRepository } from "@nestjs/typeorm";
import { ObtainedGameAchievement } from "./entity/obtained-game-achievement.entity";
import { EntityManager, FindOptionsRelations, Repository } from "typeorm";
import { ExternalGameService } from "../external-game/external-game.service";
import { SteamSyncService } from "../../sync/steam/steam-sync.service";
import { PsnSyncService } from "../../sync/psn/psn-sync.service";
import { XboxSyncService } from "../../sync/xbox/xbox-sync.service";
import { ConnectionsService } from "../../connection/connections.service";
import { EGameExternalGameCategory } from "../game-repository/game-repository.constants";
import dayjs from "dayjs";
import {
    FindObtainedGameAchievementsRequestDto,
    GameObtainedAchievementDto,
} from "./dto/game-obtained-achievement.dto";
import { EConnectionType } from "../../connection/connections.constants";
import {
    getPSNAchievementId,
    isValidXboxProductId,
} from "./game-achievement.utils";
import { GameExternalGame } from "../external-game/entity/game-external-game.entity";
import { Injectable, Logger } from "@nestjs/common";
import { ConnectionProviderRegistry } from "../../connection/connection-provider.registry";
import { UnsupportedGameAchievementSourceError } from "./game-achievement.errors";
import { UserThinTrophy } from "psn-api";
import {
    ACHIEVEMENT_CONNECTION_SOURCE,
    GAME_ACHIEVEMENT_ENABLED_SOURCES,
} from "./game-achievement.constants";
import { TPaginationData } from "../../utils/pagination/pagination-response.dto";
import { buildBaseFindOptions } from "../../utils/buildBaseFindOptions";

@Injectable()
export class GameObtainedAchievementService {
    private readonly logger = new Logger(GameObtainedAchievementService.name);
    private readonly relations: FindOptionsRelations<ObtainedGameAchievement> =
        {
            externalGame: true,
        };

    constructor(
        @InjectRepository(ObtainedGameAchievement)
        private readonly obtainedAchievementRepository: Repository<ObtainedGameAchievement>,
        private readonly externalGameService: ExternalGameService,
        private readonly steamSyncService: SteamSyncService,
        private readonly psnSyncService: PsnSyncService,
        private readonly xboxSyncService: XboxSyncService,
        private readonly connectionsService: ConnectionsService,
        private readonly syncQueue: GameAchievementSyncQueueService,
        private readonly providerRegistry: ConnectionProviderRegistry,
    ) {
        providerRegistry.registerSyncHandlers(EConnectionType.STEAM, {
            fetchObtainedAchievements: (userId, game) =>
                this.fetchSteam(userId, game),
        });
        providerRegistry.registerSyncHandlers(EConnectionType.PSN, {
            fetchObtainedAchievements: (userId, game) =>
                this.fetchPsn(userId, game),
        });
        providerRegistry.registerSyncHandlers(EConnectionType.XBOX, {
            fetchObtainedAchievements: (userId, game) =>
                this.fetchXbox(userId, game),
        });
    }

    /**
     * Find all obtained achievements from <strong>source</strong> related to an external game ID. <br />
     * Persisting the result and updating completion status are handled by the sync worker.
     * @param userId
     * @param externalGameId
     */
    public async fetchObtainedByExternalGameId(
        userId: string | undefined,
        externalGameId: number,
    ) {
        const externalGame =
            await this.externalGameService.findOneByIdOrFail(externalGameId);
        if (!userId) return [];
        const type = ACHIEVEMENT_CONNECTION_SOURCE.get(externalGame.category!);
        if (!type) throw new UnsupportedGameAchievementSourceError();
        const provider = this.providerRegistry.get(type);
        const handler = provider.syncHandlers?.fetchObtainedAchievements;
        if (!handler) throw new UnsupportedGameAchievementSourceError();
        return handler(userId, externalGame);
    }

    private async fetchSteam(
        userId: string,
        externalGame: GameExternalGame,
    ): Promise<GameObtainedAchievementDto[]> {
        const targetConnection =
            await this.connectionsService.findOneByUserIdAndType(
                userId,
                EConnectionType.STEAM,
            );
        if (!targetConnection) {
            return [];
        }

        const achievementsInSource =
            await this.steamSyncService.getUserAchievements(
                targetConnection.sourceUserId,
                Number(externalGame.uid),
            );

        return achievementsInSource.achievements.map((achievement) => {
            return {
                externalGameId: externalGame.id,
                gameId: externalGame.gameId,
                externalId: achievement.name,
                isObtained: achievement.unlocked,
                obtainedAt: achievement.unlockedTimestamp
                    ? new Date(achievement.unlockedTimestamp * 1000)
                    : null,
                source: EGameExternalGameCategory.Steam,
            } satisfies GameObtainedAchievementDto;
        });
    }

    private async fetchPsn(
        userId: string,
        externalGame: GameExternalGame,
    ): Promise<GameObtainedAchievementDto[]> {
        if (
            externalGame.psnExtraMappings == undefined ||
            externalGame.psnExtraMappings.length === 0
        ) {
            return [];
        }

        const userConnection =
            await this.connectionsService.findOneByUserIdAndType(
                userId,
                EConnectionType.PSN,
            );

        if (!userConnection) {
            return [];
        }

        const mappings = externalGame.psnExtraMappings;

        const totalObtainedTrophies: GameObtainedAchievementDto[] = [];

        const processedMappings = new Set<string>();

        for (const mapping of mappings) {
            const identity = `${mapping.npCommunicationId}:${mapping.npServiceName}`;
            if (processedMappings.has(identity)) {
                continue;
            }

            let userTrophies: UserThinTrophy[] = [];
            try {
                userTrophies =
                    await this.psnSyncService.getObtainedAchievements(
                        userConnection.sourceUserId,
                        mapping.npCommunicationId,
                        mapping.npServiceName,
                    );
            } catch (err) {
                this.logger.error(err);
                throw err;
            }

            const parsedTrophies = userTrophies.map((trophy) => {
                return {
                    externalGameId: externalGame.id,
                    gameId: externalGame.gameId,
                    isObtained: trophy.earned ?? false,
                    obtainedAt: trophy.earnedDateTime
                        ? new Date(trophy.earnedDateTime)
                        : null,
                    source: EGameExternalGameCategory.PlaystationStoreUs,
                    externalId: getPSNAchievementId(
                        mapping.npCommunicationId,
                        trophy.trophyId,
                    ),
                } satisfies GameObtainedAchievementDto;
            });

            totalObtainedTrophies.push(...parsedTrophies);

            processedMappings.add(identity);
        }

        return totalObtainedTrophies;
    }

    private async fetchXbox(
        userId: string,
        externalGame: GameExternalGame,
    ): Promise<GameObtainedAchievementDto[]> {
        const isValidProductId = isValidXboxProductId(externalGame.uid);
        if (!isValidProductId) {
            return [];
        }

        const userConnection =
            await this.connectionsService.findOneByUserIdAndType(
                userId,
                EConnectionType.XBOX,
            );

        if (!userConnection) {
            return [];
        }

        const titlePFN = await this.xboxSyncService.getPFNByProductId(
            externalGame.uid,
        );
        const titleId = await this.xboxSyncService.getTitleIdByPFN(titlePFN);

        const achievements = await this.xboxSyncService.getObtainedAchievements(
            userConnection.sourceUserId,
            titleId,
        );

        return achievements.map((achievement) => {
            const isObtained = achievement.progressState === "Achieved";

            return {
                externalGameId: externalGame.id,
                gameId: externalGame.gameId,
                source: EGameExternalGameCategory.Microsoft,
                isObtained: isObtained,
                obtainedAt: isObtained
                    ? dayjs(achievement.progression.timeUnlocked).toDate()
                    : null,
                externalId: achievement.id,
            } satisfies GameObtainedAchievementDto;
        });
    }

    public async findAllObtainedByExternalGameId(
        userId: string | undefined,
        externalGameId: number,
        viewerUserId?: string,
    ): Promise<GameObtainedAchievementDto[]> {
        const externalGame =
            await this.externalGameService.findOneByIdOrFail(externalGameId);
        if (!userId) return [];
        const source = ACHIEVEMENT_CONNECTION_SOURCE.get(
            externalGame.category!,
        );
        if (!source) throw new UnsupportedGameAchievementSourceError();
        const rows = await this.obtainedAchievementRepository.findBy({
            profileUserId: userId,
            externalGameId,
        });
        if (viewerUserId === userId) {
            try {
                await this.syncQueue.addUserSyncJob(
                    userId,
                    externalGameId,
                    source,
                );
            } catch {
                this.logger.warn({
                    event: "achievement-read-refresh-failed",
                    source,
                });
            }
        }
        return rows.map((row) => ({
            externalGameId,
            externalId: row.externalAchievementId,
            obtainedAt: row.obtainedAt,
            isObtained: true,
            source: externalGame.category!,
            gameId: externalGame.gameId,
        }));
    }

    public async findAllObtainedByGameId(
        userId: string | undefined,
        gameId: number,
        viewerUserId?: string,
    ) {
        if (!userId) return [];
        const games = await this.externalGameService.findAllForGameId([gameId]);
        const results = await Promise.all(
            games
                .filter((game) =>
                    GAME_ACHIEVEMENT_ENABLED_SOURCES.includes(game.category!),
                )
                .map((game) =>
                    this.findAllObtainedByExternalGameId(
                        userId,
                        game.id,
                        viewerUserId,
                    ),
                ),
        );
        return results.flat();
    }

    public async persistObtainedAchievements(
        userId: string,
        achievements: GameObtainedAchievementDto[],
        manager?: EntityManager,
    ) {
        const repository =
            manager?.getRepository(ObtainedGameAchievement) ??
            this.obtainedAchievementRepository;
        const groupedByExternalGameId = Map.groupBy(
            achievements,
            (a) => a.externalGameId,
        );

        const persistedEntities: ObtainedGameAchievement[] = [];

        for (const [
            externalGameId,
            achievementsForGame,
        ] of groupedByExternalGameId.entries()) {
            const obtainedAchievementsForGame = achievementsForGame.filter(
                (achievement) =>
                    achievement.isObtained && achievement.obtainedAt != null,
            );

            const existingAchievements = await repository.findBy({
                externalGameId: externalGameId,
                profileUserId: userId,
            });

            const existingAchievementsIdsSet = new Set(
                existingAchievements.map((a) => a.externalAchievementId),
            );

            const entitiesToPersist = obtainedAchievementsForGame
                .filter(
                    (achievement) =>
                        !existingAchievementsIdsSet.has(achievement.externalId),
                )
                .map((achievement) => {
                    return repository.create({
                        externalGameId: achievement.externalGameId,
                        externalAchievementId: achievement.externalId,
                        obtainedAt: achievement.obtainedAt!,
                        profileUserId: userId,
                    });
                });

            if (entitiesToPersist.length > 0) {
                const save = () => repository.save(entitiesToPersist);
                const result = manager
                    ? await save()
                    : await playerSyncWrite(save);

                persistedEntities.push(...result);
            }
        }

        return persistedEntities;
    }

    public async findAllObtainedByUserId(
        userId: string,
        dto: FindObtainedGameAchievementsRequestDto,
    ): Promise<TPaginationData<GameObtainedAchievementDto>> {
        if (userId == null) {
            return [[], 0];
        }

        const baseOptions = buildBaseFindOptions(dto);

        const [itens, count] =
            await this.obtainedAchievementRepository.findAndCount({
                ...baseOptions,
                where: {
                    profileUserId: userId,
                },
                order: {
                    obtainedAt: "DESC",
                    ...baseOptions.order,
                },
                relations: this.relations,
            });

        const itensDto = itens.map((item): GameObtainedAchievementDto => {
            return {
                externalGameId: item.externalGameId,
                externalId: item.externalAchievementId,
                obtainedAt: item.obtainedAt,
                isObtained: true,
                source: item.externalGame.category!,
                gameId: item.externalGame.gameId,
            };
        });

        return [itensDto, count];
    }

    public async existsForExternalGameId(
        userId: string,
        externalGameId: number,
    ) {
        return await this.obtainedAchievementRepository.existsBy({
            externalGameId,
            profileUserId: userId,
        });
    }

    async findOneByIdOrFail(id: number) {
        return this.obtainedAchievementRepository.findOneOrFail({
            where: {
                id,
            },
            relations: this.relations,
        });
    }
}
