import { GogSyncService } from "../../sync/gog/gog-sync.service";
import { ConnectionsService } from "../../connection/connections.service";
import { EConnectionType } from "../../connection/connections.constants";
import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { ExternalGameService } from "../external-game/external-game.service";
import { ProviderSyncError } from "../../sync/provider-sync.error";
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
import { UnsupportedGameAchievementSourceError } from "./game-achievement.errors";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { hours } from "@nestjs/throttler";
import { GameAchievementCatalog } from "./entity/game-achievement-catalog.entity";

/** How long a stored catalog is served before it is refreshed from the store; the stores' own caches lasted this long. */
const CATALOG_FRESH_MS = hours(24);
/** Stores called at once for catalogs a request waits on (never fetched before). */
const CATALOG_FETCH_BATCH_SIZE = 5;
/** Stores called at once, per process, for background refreshes. */
const MAX_CONCURRENT_REFRESHES = 4;
/** Bounds the refresh backlog; games past it are queued again on their next read. */
const MAX_QUEUED_REFRESHES = 5000;

@Injectable()
export class GameAchievementService {
    private readonly logger = new Logger(GameAchievementService.name);

    constructor(
        private readonly externalGameService: ExternalGameService,
        private readonly steamSyncService: SteamSyncService,
        private readonly psnSyncService: PsnSyncService,
        private readonly xboxSyncService: XboxSyncService,
        private readonly gameRepositoryService: GameRepositoryService,
        private readonly gogSyncService: GogSyncService,
        private readonly connectionsService: ConnectionsService,
        @InjectRepository(GameAchievementCatalog)
        private readonly catalogRepository: Repository<GameAchievementCatalog>,
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

    public async findAllByExternalGameId(
        externalGameId: number,
    ): Promise<GameAchievementDto[]> {
        const stored = await this.catalogRepository.findOneBy({
            externalGameId,
        });
        const achievements = stored
            ? this.served(stored)
            : await this.fetchCatalog(externalGameId);
        if (achievements.length === 0)
            throw new HttpException(
                "Game has no available achievements for this source.",
                HttpStatus.NOT_FOUND,
            );
        return achievements;
    }

    /**
     * Achievements of many external games, keyed by id: stored catalogs in one query, the rest fetched from the
     * stores a few at a time. Games whose store fails or lists nothing are left out.
     */
    public async findAllByExternalGameIds(
        externalGameIds: number[],
    ): Promise<Map<number, GameAchievementDto[]>> {
        const result = new Map<number, GameAchievementDto[]>();
        if (externalGameIds.length === 0) return result;
        const stored = await this.catalogRepository.findBy({
            externalGameId: In(externalGameIds),
        });
        for (const catalog of stored)
            result.set(catalog.externalGameId, this.served(catalog));

        const missing = externalGameIds.filter((id) => !result.has(id));
        for (let i = 0; i < missing.length; i += CATALOG_FETCH_BATCH_SIZE) {
            const batch = missing.slice(i, i + CATALOG_FETCH_BATCH_SIZE);
            const fetched = await Promise.allSettled(
                batch.map((id) => this.fetchCatalog(id)),
            );
            fetched.forEach((outcome, index) => {
                if (outcome.status === "fulfilled")
                    result.set(batch[index], outcome.value);
            });
        }
        for (const [id, achievements] of result)
            if (achievements.length === 0) result.delete(id);
        return result;
    }

    /** A stored catalog, queued for a refresh once it is older than CATALOG_FRESH_MS. */
    private served(catalog: GameAchievementCatalog) {
        if (Date.now() - catalog.fetchedAt.getTime() > CATALOG_FRESH_MS)
            this.queueRefresh(catalog.externalGameId);
        return catalog.achievements;
    }

    /** Fetches a game's achievements from its store and keeps them; "none" is kept too, as an empty list. */
    private async fetchCatalog(
        externalGameId: number,
    ): Promise<GameAchievementDto[]> {
        let achievements: GameAchievementDto[];
        try {
            achievements = await this.getAllByExternalGameId(
                externalGameId,
                false,
            );
        } catch (error) {
            if (
                !(error instanceof HttpException) ||
                error.getStatus() !== HttpStatus.NOT_FOUND
            )
                throw error;
            achievements = [];
        }
        await this.catalogRepository.upsert(
            { externalGameId, achievements, fetchedAt: new Date() },
            ["externalGameId"],
        );
        return achievements;
    }

    /** Fills a game's catalog in the background, or refreshes it once stale; never throws or waits on a store. */
    public warmCatalog(externalGameId: number) {
        this.catalogRepository.findOneBy({ externalGameId }).then(
            (stored) =>
                stored
                    ? this.served(stored)
                    : this.queueRefresh(externalGameId),
            (error: unknown) =>
                this.logger.warn(
                    `Achievement catalog lookup failed for external game ${externalGameId}: ${error}`,
                ),
        );
    }

    private readonly refreshQueue = new Set<number>();
    private activeRefreshes = 0;

    /** Refreshes stale catalogs in the background, a few at a time, so a read never waits on a store for them. */
    private queueRefresh(externalGameId: number) {
        if (this.refreshQueue.size >= MAX_QUEUED_REFRESHES) return;
        this.refreshQueue.add(externalGameId);
        while (
            this.activeRefreshes < MAX_CONCURRENT_REFRESHES &&
            this.refreshQueue.size > 0
        )
            void this.drainRefreshes();
    }

    private async drainRefreshes() {
        this.activeRefreshes++;
        try {
            for (const id of this.refreshQueue) {
                this.refreshQueue.delete(id);
                // A failed refresh keeps the stored catalog; the next read past the window tries again.
                await this.fetchCatalog(id).catch((error: unknown) =>
                    this.logger.warn(
                        `Achievement catalog refresh failed for external game ${id}: ${error}`,
                    ),
                );
            }
        } finally {
            this.activeRefreshes--;
        }
    }

    public findAllByExternalGameIdForSync(
        externalGameId: number,
        userId: string,
    ) {
        return this.getAllByExternalGameId(externalGameId, true, userId);
    }

    private async getAllByExternalGameId(
        externalGameId: number,
        forSync: boolean,
        userId?: string,
    ) {
        const externalGame =
            await this.externalGameService.findOneByIdOrFail(externalGameId);

        const platformsMap = forSync
            ? null
            : await this.gameRepositoryService.getGamePlatformsMap(
                  "abbreviation",
              );

        const achievements = await match<
            EGameExternalGameCategory,
            Promise<GameAchievementDto[]>
        >(externalGame.category!)
            .with(EGameExternalGameCategory.Gog, async () => {
                let achievements;
                if (forSync) {
                    if (!userId)
                        throw new ProviderSyncError(
                            "unavailable",
                            "GOG achievement sync requires a user",
                        );
                    const connection =
                        await this.connectionsService.findOneByUserIdAndType(
                            userId,
                            EConnectionType.GOG,
                        );
                    if (!connection)
                        throw new ProviderSyncError(
                            "unavailable",
                            "No GOG connection for achievement sync",
                        );
                    achievements = await this.gogSyncService.getAchievements(
                        connection.sourceUserId,
                        externalGame.uid,
                    );
                } else {
                    achievements =
                        await this.gogSyncService.getCatalogueAchievements(
                            externalGame.uid,
                        );
                }
                return achievements.map(
                    (achievement) =>
                        ({
                            name: achievement.name,
                            description: achievement.description,
                            iconUrl: achievement.image_url_unlocked,
                            externalId: achievement.achievement_id,
                            source: EGameExternalGameCategory.Gog,
                            externalGameId: externalGame.id,
                            gameId: externalGame.gameId,
                            platformIds: [6],
                        }) satisfies GameAchievementDto,
                );
            })
            .with(EGameExternalGameCategory.Steam, async () => {
                const PC_PLATFORM_ID = 6;
                const appId = Number.parseInt(externalGame.uid);
                const achievements = await this.steamSyncService
                    .getAvailableAchievements(appId)
                    .catch((error: unknown) => {
                        if (
                            !forSync &&
                            error instanceof ProviderSyncError &&
                            error.outcome === "unsupported"
                        )
                            return [];
                        throw error;
                    });
                if (achievements.length === 0) return [];
                const achievementsPercentage = forSync
                    ? []
                    : await this.steamSyncService.getAchievementsPercentage(
                          appId,
                      );

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
                        ...(forSync
                            ? {}
                            : {
                                  steamDetails: {
                                      globalPercentage: Number(
                                          relatedPercentage?.percent ?? 0,
                                      ),
                                  },
                              }),
                        platformIds: [PC_PLATFORM_ID],
                    } satisfies GameAchievementDto;
                });
            })
            .with(EGameExternalGameCategory.PlaystationStoreUs, async () => {
                if (
                    externalGame.psnExtraMappings == undefined ||
                    externalGame.psnExtraMappings.length === 0
                ) {
                    if (forSync)
                        throw new ProviderSyncError(
                            "unsupported",
                            "No trophy catalogue mapping is available",
                        );
                    throw new HttpException(
                        "Achievements are not yet available for this title.",
                        HttpStatus.NOT_FOUND,
                    );
                }

                const mappings = externalGame.psnExtraMappings;

                const totalTrophies: GameAchievementDto[] = [];

                const processedMappings = new Set<string>();

                for (const mapping of mappings) {
                    const identity = `${mapping.npCommunicationId}:${mapping.npServiceName}`;
                    if (processedMappings.has(identity)) {
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
                            platformIds: forSync
                                ? []
                                : [
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

                    processedMappings.add(identity);
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
                        if (forSync)
                            throw new ProviderSyncError(
                                "unsupported",
                                "Invalid Xbox product ID",
                            );
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

                        const availablePlatformIds = forSync
                            ? []
                            : achievement.platforms.map((platform) => {
                                  return match(platform)
                                      .with(
                                          P.union("PC", "Win32"),
                                          () => platformsMap!.get("PC")!.id,
                                      )
                                      .with(
                                          "Xbox360",
                                          () => platformsMap!.get("X360")!.id,
                                      )
                                      .with(
                                          "XboxOne",
                                          () => platformsMap!.get("XONE")!.id,
                                      )
                                      .with(
                                          "XboxSeries",
                                          () =>
                                              platformsMap!.get("Series X|S")!
                                                  .id,
                                      )
                                      .otherwise(
                                          () =>
                                              platformsMap!.get("Series X|S")!
                                                  .id,
                                      );
                              });

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
                throw new UnsupportedGameAchievementSourceError();
            });

        if (!forSync && achievements.length === 0) {
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
