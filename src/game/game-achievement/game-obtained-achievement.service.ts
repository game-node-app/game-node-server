import { InjectRepository } from "@nestjs/typeorm";
import { ObtainedGameAchievement } from "./entity/obtained-game-achievement.entity";
import { FindOptionsRelations, Repository } from "typeorm";
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
import { UnrecoverableError } from "bullmq";
import { EConnectionType } from "../../connection/connections.constants";
import {
    getPSNAchievementId,
    isValidXboxProductId,
} from "./game-achievement.utils";
import { match, P } from "ts-pattern";
import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import { UserThinTrophy } from "psn-api";
import { GAME_ACHIEVEMENT_ENABLED_SOURCES } from "./game-achievement.constants";
import { TPaginationData } from "../../utils/pagination/pagination-response.dto";
import { buildBaseFindOptions } from "../../utils/buildBaseFindOptions";
import { GameAchievementStatusService } from "./game-achievement-status.service";

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
        @Inject(forwardRef(() => GameAchievementStatusService))
        private readonly gameAchievementStatusService: GameAchievementStatusService,
        private readonly externalGameService: ExternalGameService,
        private readonly steamSyncService: SteamSyncService,
        private readonly psnSyncService: PsnSyncService,
        private readonly xboxSyncService: XboxSyncService,
        private readonly connectionsService: ConnectionsService,
    ) {}

    /**
     * Find all obtained achievements from <strong>source</strong> related to an external game ID. <br />
     * Internally, this method also updates our database with the obtained achievements that are not yet
     * persisted and updates the game completion status accordingly, if persistNewlyObtained is truthy.
     * @param userId
     * @param externalGameId
     */
    public async findAllObtainedByExternalGameId(
        userId: string | undefined,
        externalGameId: number,
    ) {
        const externalGame =
            await this.externalGameService.findOneByIdOrFail(externalGameId);

        if (!userId) {
            return [];
        }

        return await match<
            EGameExternalGameCategory,
            Promise<GameObtainedAchievementDto[]>
        >(externalGame.category!)
            .with(EGameExternalGameCategory.Steam, async () => {
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
            })
            /**
             * TODO: Make this return matches for ALL mappings
             */
            .with(EGameExternalGameCategory.PlaystationStoreUs, async () => {
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

                const processedNpServiceNames = new Set<string>();

                for (const mapping of mappings) {
                    if (processedNpServiceNames.has(mapping.npServiceName)) {
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

                    processedNpServiceNames.add(mapping.npServiceName);
                }

                return totalObtainedTrophies;
            })
            .with(
                P.union(
                    EGameExternalGameCategory.Microsoft,
                    EGameExternalGameCategory.XboxMarketplace,
                    EGameExternalGameCategory.XboxGamePassUltimateCloud,
                ),
                async () => {
                    const isValidProductId = isValidXboxProductId(
                        externalGame.uid,
                    );
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

                    const titlePFN =
                        await this.xboxSyncService.getPFNByProductId(
                            externalGame.uid,
                        );
                    const titleId =
                        await this.xboxSyncService.getTitleIdByPFN(titlePFN);

                    const achievements =
                        await this.xboxSyncService.getObtainedAchievements(
                            userConnection.sourceUserId,
                            titleId,
                        );

                    return achievements.map((achievement) => {
                        const isObtained =
                            achievement.progressState === "Achieved";

                        return {
                            externalGameId: externalGame.id,
                            gameId: externalGame.gameId,
                            source: EGameExternalGameCategory.Microsoft,
                            isObtained: isObtained,
                            obtainedAt: isObtained
                                ? dayjs(
                                      achievement.progression.timeUnlocked,
                                  ).toDate()
                                : null,
                            externalId: achievement.id,
                        } satisfies GameObtainedAchievementDto;
                    });
                },
            )
            .otherwise(() => {
                throw new UnrecoverableError(
                    "Category mapping not implemented.",
                );
            });
    }

    /**
     * Retrieves all obtained items related to a specific game ID.
     */
    public async findAllObtainedByGameId(
        userId: string | undefined,
        gameId: number,
    ) {
        if (userId == undefined) {
            return [];
        }

        const externalGames = await this.externalGameService.findAllForGameId([
            gameId,
        ]);

        const enabledExternalGames = externalGames.filter((externalGame) =>
            GAME_ACHIEVEMENT_ENABLED_SOURCES.includes(externalGame.category!),
        );

        if (enabledExternalGames.length === 0) {
            return [];
        }

        const results: GameObtainedAchievementDto[] = [];

        const promises = await Promise.allSettled(
            enabledExternalGames.map((externalGame) =>
                this.findAllObtainedByExternalGameId(userId, externalGame.id),
            ),
        );

        for (const promise of promises) {
            if (promise.status === "fulfilled") {
                results.push(...promise.value);
            }
        }

        this.persistObtainedAchievements(userId, results).catch((err) => {
            this.logger.error(
                `Error persisting obtained achievements for user ${userId} and game ${gameId}: ${err}`,
                err,
            );
        });

        return results;
    }

    public async persistObtainedAchievements(
        userId: string,
        achievements: GameObtainedAchievementDto[],
    ) {
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

            const existingAchievements =
                await this.obtainedAchievementRepository.findBy({
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
                    return this.obtainedAchievementRepository.create({
                        externalGameId: achievement.externalGameId,
                        externalAchievementId: achievement.externalId,
                        obtainedAt: achievement.obtainedAt!,
                        profileUserId: userId,
                    });
                });

            if (entitiesToPersist.length > 0) {
                const result =
                    await this.obtainedAchievementRepository.save(
                        entitiesToPersist,
                    );

                persistedEntities.push(...result);
            }

            /**
             * Temporarily executes update logic for all games while we backfill the data.
             */
            await this.gameAchievementStatusService.updateGameCompletionStatus(
                userId,
                externalGameId,
            );
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
