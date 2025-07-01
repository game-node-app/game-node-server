import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { ExternalGameService } from "../external-game/external-game.service";
import { SteamSyncService } from "../../sync/steam/steam-sync.service";
import { match } from "ts-pattern";
import { EGameExternalGameCategory } from "../game-repository/game-repository.constants";
import { GameAchievementDto } from "./dto/game-achievement.dto";
import { UnrecoverableError } from "bullmq";
import { GameObtainedAchievementDto } from "./dto/game-obtained-achievement.dto";
import { ConnectionsService } from "../../connections/connections.service";
import { EConnectionType } from "../../connections/connections.constants";

@Injectable()
export class GameAchievementService {
    constructor(
        private readonly externalGameService: ExternalGameService,
        private readonly steamSyncService: SteamSyncService,
        private readonly connectionsService: ConnectionsService,
    ) {}

    public async findOneByExternalGameId(
        externalGameId: number,
        externalAchievementId: string,
    ) {
        const achievements = await this.findAllByExternalGameId(externalGameId);

        const relatedAchievement = achievements.find(
            (achievement) => achievement.externalId === externalAchievementId,
        );

        if (!relatedAchievement) {
            throw new HttpException(
                "No achievement matching criteria.",
                HttpStatus.NOT_FOUND,
            );
        }

        return relatedAchievement;
    }

    public async findAllByExternalGameId(externalGameId: number) {
        const externalGame =
            await this.externalGameService.findOneByIdOrFail(externalGameId);

        const achievements = await match<
            EGameExternalGameCategory,
            Promise<GameAchievementDto[]>
        >(externalGame.category!)
            .with(EGameExternalGameCategory.Steam, async () => {
                const appId = Number.parseInt(externalGame.uid);
                const [achievements, achievementsPercentage] =
                    await Promise.all([
                        this.steamSyncService.getAvailableAchievements(appId),
                        this.steamSyncService.getAchievementsPercentage(appId),
                    ]);

                return achievements.map((achievement) => {
                    const relatedPercentage = achievementsPercentage.find(
                        (percentage) => percentage.name === achievement.name,
                    );
                    return {
                        name: achievement.displayName,
                        description: achievement.description ?? null,
                        iconUrl: achievement.icon,
                        iconGrayUrl: achievement.icongray,
                        source: EGameExternalGameCategory.Steam,
                        externalGameId: externalGame.id,
                        gameId: externalGame.gameId,
                        externalId: achievement.name,
                        steamDetails: {
                            globalPercentage: Number(
                                relatedPercentage?.percent ?? 0,
                            ),
                        },
                    } satisfies GameAchievementDto;
                });
            })
            .otherwise(() => {
                throw new UnrecoverableError(
                    "Category mapping not implemented.",
                );
            });

        if (achievements.length === 0) {
            throw new UnrecoverableError(
                "Game has no available achievements for this source.",
            );
        }

        return achievements;
    }

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
                        gameId: externalGame.id,
                        externalId: achievement.name,
                        isObtained: achievement.unlocked,
                        obtainedAt: achievement.unlockedTimestamp
                            ? new Date(achievement.unlockedTimestamp * 1000)
                            : null,
                        source: EGameExternalGameCategory.Steam,
                    } satisfies GameObtainedAchievementDto;
                });
            })
            .otherwise(() => {
                throw new UnrecoverableError(
                    "Category mapping not implemented.",
                );
            });
    }
}
