import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { ExternalGameService } from "../external-game/external-game.service";
import { SteamSyncService } from "../../sync/steam/steam-sync.service";
import { match, P } from "ts-pattern";
import { EGameExternalGameCategory } from "../game-repository/game-repository.constants";
import {
    GameAchievementDto,
    GameAchievementGroupDto,
} from "./dto/game-achievement.dto";
import { PsnSyncService } from "../../sync/psn/psn-sync.service";
import { XboxSyncService } from "../../sync/xbox/xbox-sync.service";
import { GAME_ACHIEVEMENT_ENABLED_SOURCES } from "./game-achievement.constants";

import {
    getIconNameForExternalGameCategory,
    getStoreAbbreviatedNameForExternalGameCategory,
    getStoreNameForExternalGameCategory,
} from "../external-game/external-game.utils";
import { GameRepositoryService } from "../game-repository/game-repository.service";
import {
    getPSNAchievementId,
    isValidXboxProductId,
} from "./game-achievement.utils";
import { Cache } from "@nestjs/cache-manager";
import { Cacheable } from "../../utils/cacheable";
import { hours, minutes } from "@nestjs/throttler";

@Injectable()
export class GameAchievementService {
    private readonly logger = new Logger(GameAchievementService.name);

    constructor(
        private readonly externalGameService: ExternalGameService,
        private readonly steamSyncService: SteamSyncService,
        private readonly psnSyncService: PsnSyncService,
        private readonly xboxSyncService: XboxSyncService,
        private readonly gameRepositoryService: GameRepositoryService,
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

        const platformsMap =
            await this.gameRepositoryService.getGamePlatformsMap(
                "abbreviation",
            );

        const achievements = await match<
            EGameExternalGameCategory,
            Promise<GameAchievementDto[]>
        >(externalGame.category!)
            .with(EGameExternalGameCategory.Steam, async () => {
                const PC_PLATFORM_ID = 6;
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
                        source: EGameExternalGameCategory.Steam,
                        externalGameId: externalGame.id,
                        gameId: externalGame.gameId,
                        externalId: achievement.name,
                        steamDetails: {
                            globalPercentage: Number(
                                relatedPercentage?.percent ?? 0,
                            ),
                        },
                        platformIds: [PC_PLATFORM_ID],
                    } satisfies GameAchievementDto;
                });
            })
            .with(EGameExternalGameCategory.PlaystationStoreUs, async () => {
                if (
                    externalGame.psnExtraMappings == undefined ||
                    externalGame.psnExtraMappings.length === 0
                ) {
                    throw new HttpException(
                        "Achievements are not yet available for this title.",
                        HttpStatus.NOT_FOUND,
                    );
                }

                const mappings = externalGame.psnExtraMappings;

                const totalTrophies: GameAchievementDto[] = [];

                const processedNpServiceNames = new Set<string>();

                for (const mapping of mappings) {
                    if (processedNpServiceNames.has(mapping.npServiceName)) {
                        continue;
                    }
                    const trophies =
                        await this.psnSyncService.getGameAchievements(
                            mapping.npCommunicationId,
                            mapping.npServiceName,
                        );

                    const parsedTrophies = trophies.map((trophy) => {
                        return {
                            externalGameId: externalGame.id,
                            gameId: externalGame.gameId,
                            source: EGameExternalGameCategory.PlaystationStoreUs,
                            externalId: getPSNAchievementId(
                                mapping.npCommunicationId,
                                trophy.trophyId,
                            ),
                            iconUrl: trophy.trophyIconUrl!,
                            description: trophy.trophyDetail ?? null,
                            name: trophy.trophyName!,
                            platformIds: [
                                mapping.npServiceName === "trophy2"
                                    ? // PS5
                                      167
                                    : // PS4
                                      48,
                            ],
                            psnDetails: {
                                trophyIcon: `psn_trophy_rarity_${trophy.trophyType}`,
                                trophyType: trophy.trophyType,
                                trophyGroupId:
                                    trophy.trophyGroupId ?? "default",
                            },
                        } satisfies GameAchievementDto;
                    });

                    totalTrophies.push(...parsedTrophies);

                    processedNpServiceNames.add(mapping.npServiceName);
                }

                return totalTrophies;
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
                        throw new HttpException(
                            "Achievements are not yet available for this title.",
                            HttpStatus.NOT_FOUND,
                        );
                    }

                    const titlePFN =
                        await this.xboxSyncService.getPFNByProductId(
                            externalGame.uid,
                        );
                    const titleId =
                        await this.xboxSyncService.getTitleIdByPFN(titlePFN);

                    const achievements =
                        await this.xboxSyncService.getAvailableAchievements(
                            titleId,
                        );

                    return achievements.map((achievement) => {
                        const icon = achievement.mediaAssets.find(
                            (asset) => asset.type === "Icon",
                        );
                        const gamerScore = achievement.rewards.find(
                            (reward) => reward.type === "Gamerscore",
                        );

                        const availablePlatformIds = achievement.platforms.map(
                            (platform) => {
                                return match(platform)
                                    .with(
                                        P.union("PC", "Win32"),
                                        () => platformsMap.get("PC")!.id,
                                    )
                                    .with(
                                        "Xbox360",
                                        () => platformsMap.get("X360")!.id,
                                    )
                                    .with(
                                        "XboxOne",
                                        () => platformsMap.get("XONE")!.id,
                                    )
                                    .with(
                                        "XboxSeries",
                                        () =>
                                            platformsMap.get("Series X|S")!.id,
                                    )
                                    .otherwise(
                                        () =>
                                            platformsMap.get("Series X|S")!.id,
                                    );
                            },
                        );

                        return {
                            externalGameId: externalGame.id,
                            source: EGameExternalGameCategory.Microsoft,
                            gameId: externalGame.gameId,
                            name: achievement.name,
                            externalId: achievement.id,
                            description: achievement.description,
                            iconUrl: icon?.url ?? "xbox_achievement",
                            xboxDetails: {
                                gamerScore: gamerScore?.value
                                    ? Number(gamerScore?.value)
                                    : 0,
                            },
                            // XONE and X Series S/X
                            platformIds: availablePlatformIds,
                        } satisfies GameAchievementDto;
                    });
                },
            )
            .otherwise(() => {
                throw new HttpException(
                    "Category mapping not implemented.",
                    HttpStatus.BAD_REQUEST,
                );
            });

        if (achievements.length === 0) {
            throw new HttpException(
                "Game has no available achievements for this source.",
                HttpStatus.NOT_FOUND,
            );
        }

        return achievements;
    }

    /**
     * Finds and retrieves all associated achievements by a given game ID.
     */
    public async findAllByGameId(
        gameId: number,
    ): Promise<GameAchievementGroupDto[]> {
        const externalGames = await this.externalGameService.findAllForGameId([
            gameId,
        ]);
        const enabledExternalGames = externalGames.filter((externalGame) =>
            GAME_ACHIEVEMENT_ENABLED_SOURCES.includes(externalGame.category!),
        );

        if (enabledExternalGames.length === 0) {
            return [];
        }

        const results: GameAchievementDto[] = [];

        const promises = await Promise.allSettled(
            enabledExternalGames.map((externalGame) =>
                this.findAllByExternalGameId(externalGame.id),
            ),
        );

        for (const promise of promises) {
            if (promise.status === "fulfilled") {
                results.push(...promise.value);
            }
        }

        const groupedBySource: Map<
            EGameExternalGameCategory,
            GameAchievementDto[]
        > = Map.groupBy(results, (result) => result.source!);

        return Array.from(groupedBySource.entries()).map(
            ([source, achievements]) => ({
                source,
                sourceName: getStoreNameForExternalGameCategory(source)!,
                sourceAbbreviatedName:
                    getStoreAbbreviatedNameForExternalGameCategory(source)!,
                iconName: getIconNameForExternalGameCategory(source)!,
                achievements,
            }),
        );
    }
}
