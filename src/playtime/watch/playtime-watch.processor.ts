import { generateChecksum } from "../../utils/checksum";
import {
    assertPlayerSyncActive,
    recordPlayerSyncStats,
} from "../../sync/player-sync-attempt";
import { OnWorkerEvent, Processor } from "@nestjs/bullmq";
import {
    PLAYTIME_WATCH_QUEUE_JOB_NAME,
    PLAYTIME_WATCH_QUEUE_NAME,
    PlaytimeWatchJob,
    PlaytimeWatchJobProgress,
} from "./playtime-watch.constants";
import { WorkerHostProcessor } from "../../utils/WorkerHostProcessor";
import { Logger } from "@nestjs/common";
import { Job, UnrecoverableError } from "bullmq";
import { ConnectionProviderRegistry } from "../../connection/connection-provider.registry";
import { ConnectionsService } from "../../connection/connections.service";
import { EConnectionType } from "../../connection/connections.constants";
import { SteamSyncService } from "../../sync/steam/steam-sync.service";
import { PsnSyncService } from "../../sync/psn/psn-sync.service";
import { ExternalGameService } from "../../game/external-game/external-game.service";
import { EGameExternalGameCategory } from "../../game/game-repository/game-repository.constants";
import { PlaytimeService } from "../playtime.service";
import { UserPlaytimeSource } from "../playtime.constants";
import dayjs from "dayjs";
import { CreateUserPlaytimeDto } from "../dto/create-user-playtime.dto";
import { XboxSyncService } from "../../sync/xbox/xbox-sync.service";
import { ExternalGameMappingsService } from "../../game/external-game/external-game-mappings.service";
import * as process from "process";
import { seconds } from "@nestjs/throttler";
import { GameRepositoryService } from "../../game/game-repository/game-repository.service";
import { match } from "ts-pattern";
import { getPreferredXboxPlatformAbbreviation } from "../../sync/xbox/util/get-preferred-xbox-platform-abbreviation";
import { GameAchievementSyncQueueService } from "../../game/game-achievement/sync/game-achievement-sync-queue.service";

@Processor(PLAYTIME_WATCH_QUEUE_NAME, {
    concurrency: 1,
    limiter:
        process.env.NODE_ENV === "development"
            ? {
                  max: 1,
                  duration: seconds(60),
              }
            : undefined,
})
export class PlaytimeWatchProcessor extends WorkerHostProcessor {
    logger = new Logger(PlaytimeWatchProcessor.name);

    constructor(
        private readonly playtimeService: PlaytimeService,
        private readonly connectionsService: ConnectionsService,
        private readonly externalGameService: ExternalGameService,
        private readonly externalGameMappingsService: ExternalGameMappingsService,
        private readonly steamSyncService: SteamSyncService,
        private readonly psnSyncService: PsnSyncService,
        private readonly xboxSyncService: XboxSyncService,
        private readonly gameRepositoryService: GameRepositoryService,
        private readonly gameAchievementSyncQueueService: GameAchievementSyncQueueService,
        private readonly registry: ConnectionProviderRegistry,
    ) {
        super();
        registry.registerSyncHandlers(EConnectionType.STEAM, {
            fetchPlaytime: (job) => this.updateSteamPlaytimeInfo(job),
        });
        registry.registerSyncHandlers(EConnectionType.PSN, {
            fetchPlaytime: (job) => this.updatePsnPlaytimeInfo(job),
        });
        registry.registerSyncHandlers(EConnectionType.XBOX, {
            fetchPlaytime: (job) => this.updateXboxPlaytimeInfo(job),
        });
    }

    async updatePlaytimeInfo(
        source: string | EConnectionType,
        job: Job<PlaytimeWatchJob>,
    ) {
        const provider = this.registry.get(source);
        const handler = provider.syncHandlers?.fetchPlaytime;
        if (!provider.isPlaytimeImportViable || !handler) {
            throw new UnrecoverableError("Unsupported player source");
        }
        return handler(job);
    }

    async process(_job: Job) {
        return { outcome: "legacy-skip" };
    }

    @OnWorkerEvent("progress")
    async onProgress(job: Job<PlaytimeWatchJob>) {
        if (!(job.name === PLAYTIME_WATCH_QUEUE_JOB_NAME)) {
            return;
        }
        const userId = job.data.userId;
        const source = job.data.source;
        const { error, totalUpdatedGames, gameName, platform } =
            job.progress as PlaytimeWatchJobProgress;

        if (error) {
            this.logger.error(
                `Playtime update failed for user ${userId} in ${source}: ${error}`,
            );
            return;
        }
        if (totalUpdatedGames != undefined) {
            this.logger.log(
                `Updated ${totalUpdatedGames} games for user ${userId} in ${source}.`,
            );
            return;
        }

        if (gameName != undefined) {
            this.logger.log(
                `Updated playtime for game ${gameName} in platform ${platform} for user ${userId} in ${source}.`,
            );
        }
    }

    @OnWorkerEvent("failed")
    async onFailed(job: Job<PlaytimeWatchJob>) {
        if (!(job.name === PLAYTIME_WATCH_QUEUE_JOB_NAME)) {
            return;
        }

        const { failedReason } = job;
        const userId = job.data.userId;
        const source = job.data.source;
        this.logger.error(
            `Playtime update failed for user ${userId} in ${source}: ${failedReason}`,
        );
    }

    async updateSteamPlaytimeInfo(job: Job<PlaytimeWatchJob>) {
        const userId = job.data.userId;

        const connection =
            await this.connectionsService.findOneByUserIdAndTypeOrFail(
                userId,
                EConnectionType.STEAM,
            );

        /**
         * We list entries from both the full library and recently played games
         * endpoints to mitigate potential issues with the library endpoint after a Steam API change in
         * mid 2024, which caused many users to have no playtime info or games listed at all.
         * The recently played games endpoint is not affected by this change, but only returns games played in the last two weeks,
         * so we use it as a fallback to at least get some playtime info for affected users.
         * The recently played games endpoint also include Family Sharing games, unlike the getAllGames endpoint.
         */
        const userGames = await this.steamSyncService.getLibraryGames(
            connection.sourceUserId,
        );

        recordPlayerSyncStats({ gamesSeen: userGames.length });
        if (userGames.length === 0) {
            job.updateProgress({
                totalUpdatedGames: 0,
            } satisfies PlaytimeWatchJobProgress);
            return {
                outcome: "empty" as const,
                externalGamesProcessed: [],
            };
        }

        const gamesUids = Array.from(
            new Set(userGames.map((item) => `${item.game.id}`)),
        );

        const externalGames =
            await this.externalGameService.getExternalGamesForSourceIds(
                gamesUids,
                EGameExternalGameCategory.Steam,
            );

        const mappedUids = new Set(externalGames.map((game) => game.uid));
        for (const uid of gamesUids) {
            if (mappedUids.has(uid)) continue;
            assertPlayerSyncActive();
            await this.externalGameService.registerUnmappedGame(
                uid,
                EGameExternalGameCategory.Steam,
            );
        }
        const userGamesByApp = Map.groupBy(userGames, (game) =>
            String(game.game.id),
        );

        const PC_PLATFORM_ID = 6;

        /**
         * In some cases, different game editions (with different app ids) point to the same gameId.
         * e.g.: Metro Exodus (AppID 412020) and Metro Exodus Enhanced Edition (AppID 1449560). <br >
         * We group so we may merge playtime for different versions.
         */
        const groupedByGameId = Map.groupBy(
            externalGames,
            (item) => item.gameId,
        );

        const existing = await this.playtimeService.findForImport(
            userId,
            UserPlaytimeSource.STEAM,
            [...groupedByGameId.keys()],
        );
        const playtimes: CreateUserPlaytimeDto[] = [];
        for (const [gameId, items] of groupedByGameId.entries()) {
            const relatedUserGames = items.flatMap(
                (item) => userGamesByApp.get(item.uid) ?? [],
            );

            const recentPlaytimeSeconds = relatedUserGames.reduce(
                (acc, item) => {
                    return acc + item.recentMinutes * 60;
                },
                0,
            );

            const totalPlaytimeSeconds = relatedUserGames.reduce(
                (acc, item) => {
                    return acc + item.minutes * 60;
                },
                0,
            );

            const existingPlaytimeInfo = existing.get(
                `${gameId}:${PC_PLATFORM_ID}`,
            );

            const hasChangedTotalPlaytime =
                existingPlaytimeInfo != undefined &&
                existingPlaytimeInfo.totalPlaytimeSeconds !==
                    totalPlaytimeSeconds;

            /**
             * After a recent Steam API change, most users won't have the 'lastPlayedTimestamp' defined.
             * This limits most features that rely on the 'lastPlayedDate' being present, like wrapped (recently played games).
             * We simply define the last played date as the week before last as a fallback if the user has recent playtime.
             * PS: Steam always considers the two last weeks for "recentMinutes".
             * PS2: This is also updated below if we detect the game has been played 'today'.
             */
            let lastPlayedDate: Date | undefined;
            if (recentPlaytimeSeconds) {
                const currentLastPlayedDate =
                    existingPlaytimeInfo?.lastPlayedDate
                        ? dayjs(existingPlaytimeInfo?.lastPlayedDate)
                        : null;

                const weekBeforeLast = dayjs().subtract(2, "weeks");

                // Only manually updates if the last persisted date is older than two weeks ago.
                if (
                    currentLastPlayedDate == null ||
                    weekBeforeLast.isAfter(currentLastPlayedDate)
                ) {
                    lastPlayedDate = weekBeforeLast.toDate();
                }
            }

            for (const externalGame of items) {
                assertPlayerSyncActive();
                await this.gameAchievementSyncQueueService.addUserSyncJob(
                    userId,
                    externalGame.id,
                    EConnectionType.STEAM,
                    generateChecksum(
                        (userGamesByApp.get(externalGame.uid) ?? []).map(
                            (game) => [
                                game.game.id,
                                game.minutes ?? 0,
                                game.recentMinutes ?? 0,
                            ],
                        ),
                    ),
                );
            }

            const playtime: CreateUserPlaytimeDto = {
                totalPlayCount: 0,
                ...existingPlaytimeInfo,
                gameId: gameId,
                profileUserId: userId,
                lastPlayedDate: lastPlayedDate,
                totalPlaytimeSeconds: totalPlaytimeSeconds,
                recentPlaytimeSeconds: recentPlaytimeSeconds,
                firstPlayedDate: undefined,
                source: UserPlaytimeSource.STEAM,
                platformId: PC_PLATFORM_ID,
            };

            // We infer the game was played 'today'.
            if (hasChangedTotalPlaytime) {
                playtime.lastPlayedDate = new Date();
            }

            job.updateProgress({
                gameName: items[0].name,
                platform: "PC",
                totalPlaytimeSeconds: totalPlaytimeSeconds,
            } satisfies PlaytimeWatchJobProgress);

            assertPlayerSyncActive();
            playtimes.push(playtime);
        }
        await this.playtimeService.saveImported(playtimes, existing);

        job.updateProgress({
            totalUpdatedGames: groupedByGameId.size,
        } satisfies PlaytimeWatchJobProgress);
    }

    async updatePsnPlaytimeInfo(job: Job<PlaytimeWatchJob>) {
        const userId = job.data.userId;

        const connection =
            await this.connectionsService.findOneByUserIdAndTypeOrFail(
                userId,
                EConnectionType.PSN,
            );

        const [userGames, userTrophyTitles] = await Promise.all([
            this.psnSyncService.getAllGames(connection.sourceUserId),
            this.psnSyncService.getUserTrophyTitles(connection.sourceUserId),
        ]);

        recordPlayerSyncStats({ gamesSeen: userGames.length });
        if (userGames.length === 0) {
            job.updateProgress({
                totalUpdatedGames: 0,
            });
            return { outcome: "empty" as const };
        }

        const gamesUids = [
            ...new Set(userGames.map((item) => `${item.concept.id}`)),
        ];

        const externalGames =
            await this.externalGameService.getExternalGamesForSourceIds(
                gamesUids,
                EGameExternalGameCategory.PlaystationStoreUs,
            );

        const mappedUids = new Set(externalGames.map((game) => game.uid));
        for (const uid of gamesUids) {
            if (mappedUids.has(uid)) continue;
            assertPlayerSyncActive();
            await this.externalGameService
                .registerUnmappedGame(
                    uid,
                    EGameExternalGameCategory.PlaystationStoreUs,
                )
                .catch((err) => this.logger.error(err));
        }

        const groupedByConcept = Map.groupBy(userGames, (item) =>
            String(item.concept.id),
        );
        const platformsMap =
            await this.gameRepositoryService.getGamePlatformsMap(
                "abbreviation",
            );
        const externalByConcept = new Map(
            externalGames.map((game) => [game.uid, game]),
        );
        const trophyByIdentity = new Map(
            userTrophyTitles.map((title) => [
                `${title.npCommunicationId}:${title.npServiceName}`,
                title,
            ]),
        );
        const existing = await this.playtimeService.findForImport(
            userId,
            UserPlaytimeSource.PSN,
            externalGames.map((game) => game.gameId),
        );
        const playtimes: CreateUserPlaytimeDto[] = [];
        let unresolved = 0;
        for (const [conceptId, titles] of groupedByConcept) {
            const relatedExternalGame = externalByConcept.get(conceptId);
            if (!relatedExternalGame) continue;
            // shortcut: the SDK exposes no concept-to-trophy association, retain persisted mappings until a verified source is available.
            const mappings = relatedExternalGame.psnExtraMappings ?? [];
            if (!mappings.length) unresolved++;
            for (const mapping of mappings)
                await this.externalGameMappingsService.upsertPsnMappings({
                    externalGameId: relatedExternalGame.id,
                    npServiceName: mapping.npServiceName,
                    npCommunicationId: mapping.npCommunicationId,
                });
            if (mappings.length) {
                const progress = mappings
                    .map((mapping) => {
                        const identity = `${mapping.npCommunicationId}:${mapping.npServiceName}`;
                        const trophy = trophyByIdentity.get(identity);
                        return [
                            identity,
                            trophy?.trophySetVersion ?? null,
                            trophy?.lastUpdatedDateTime ?? null,
                            trophy?.progress ?? null,
                            trophy?.earnedTrophies ?? null,
                        ];
                    })
                    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
                await this.gameAchievementSyncQueueService.addUserSyncJob(
                    userId,
                    relatedExternalGame.id,
                    EConnectionType.PSN,
                    generateChecksum(progress),
                );
            }
            for (const title of titles) {
                const targetPlatform = match(title.category)
                    .with("ps5_native_game", () => platformsMap.get("PS5")!)
                    .with("ps4_game", () => platformsMap.get("PS4")!)
                    .with("pspc_game", () => platformsMap.get("PSP")!)
                    .otherwise(() => platformsMap.get("PS3")!);
                const existingPlaytimeInfo = existing.get(
                    `${relatedExternalGame.gameId}:${targetPlatform.id}`,
                );
                const playtime: CreateUserPlaytimeDto = {
                    ...existingPlaytimeInfo,
                    gameId: relatedExternalGame.gameId,
                    firstPlayedDate: new Date(title.firstPlayedDateTime),
                    lastPlayedDate: new Date(title.lastPlayedDateTime),
                    profileUserId: userId,
                    totalPlaytimeSeconds: dayjs
                        .duration(title.playDuration)
                        .asSeconds(),
                    recentPlaytimeSeconds: undefined,
                    totalPlayCount: title.playCount,
                    source: UserPlaytimeSource.PSN,
                    platformId: targetPlatform.id,
                };
                job.updateProgress({
                    gameName: relatedExternalGame.name,
                    platform: targetPlatform.abbreviation,
                    totalPlaytimeSeconds: playtime.totalPlaytimeSeconds,
                } satisfies PlaytimeWatchJobProgress);
                assertPlayerSyncActive();
                playtimes.push(playtime);
            }
        }

        await this.playtimeService.saveImported(playtimes, existing);
        if (unresolved)
            this.logger.log({
                event: "psn-unresolved-mapping",
                games: unresolved,
            });
        job.updateProgress({
            totalUpdatedGames: groupedByConcept.size,
        } satisfies PlaytimeWatchJobProgress);
    }

    async updateXboxPlaytimeInfo(job: Job<PlaytimeWatchJob>) {
        const userId = job.data.userId;

        const connection =
            await this.connectionsService.findOneByUserIdAndTypeOrFail(
                userId,
                EConnectionType.XBOX,
            );

        const allGames = await this.xboxSyncService.getAllGames(
            connection.sourceUserId,
        );

        recordPlayerSyncStats({ gamesSeen: allGames.length });
        if (allGames.length === 0) {
            job.updateProgress({
                totalUpdatedGames: 0,
            });
            return { outcome: "empty" as const };
        }

        const sourceUids = [...new Set(allGames.map((game) => game.productId))];

        const externalGames =
            await this.externalGameService.getExternalGamesForSourceIds(
                sourceUids,
                EGameExternalGameCategory.Microsoft,
            );

        const externalByProduct = new Map(
            externalGames.map((game) => [game.uid, game]),
        );
        const relevantTitles = allGames.filter((game) =>
            externalByProduct.has(game.productId),
        );
        for (const game of relevantTitles) {
            await this.gameAchievementSyncQueueService.addUserSyncJob(
                userId,
                externalByProduct.get(game.productId)!.id,
                EConnectionType.XBOX,
                generateChecksum([
                    game.titleId,
                    game.achievement,
                    game.titleHistory?.lastTimePlayed ?? null,
                ]),
            );
        }
        const relevantTitleIds = relevantTitles.map((game) => game.titleId);

        // A small portion of the items may not have stats, and some will not have the 'value' defined anyway.
        const playtimeStats = await this.xboxSyncService.getBatchMinutesPlayed(
            connection.sourceUserId,
            relevantTitleIds,
        );

        const platformsMap =
            await this.gameRepositoryService.getGamePlatformsMap(
                "abbreviation",
            );

        const existing = await this.playtimeService.findForImport(
            userId,
            UserPlaytimeSource.XBOX,
            externalGames.map((game) => game.gameId),
        );
        // Missing MinutesPlayed must not prevent known recent increments from expiring.
        const playtimes: CreateUserPlaytimeDto[] = [...existing.values()].map(
            (playtime) => ({ ...playtime, recentPlaytimeSeconds: undefined }),
        );
        const gamesByTitle = new Map(
            [...Map.groupBy(allGames, (game) => game.titleId)].map(
                ([id, games]) => [id, games[0]],
            ),
        );
        for (const stats of playtimeStats) {
            if (stats.value == undefined) continue;

            const relevantGame = gamesByTitle.get(stats.titleid)!;
            const relevantExternalGame = externalByProduct.get(
                relevantGame.productId,
            )!;

            const deviceTitles = relevantGame.devices.flat(1);

            const preferredPlatformAbbreviation =
                getPreferredXboxPlatformAbbreviation(deviceTitles);
            const preferredPlatform = platformsMap.get(
                preferredPlatformAbbreviation,
            )!;

            const existingPlaytimeInfo = existing.get(
                `${relevantExternalGame.gameId}:${preferredPlatform.id}`,
            );

            const playtime: CreateUserPlaytimeDto = {
                ...existingPlaytimeInfo,
                gameId: relevantExternalGame.gameId,
                profileUserId: userId,
                lastPlayedDate: relevantGame.titleHistory?.lastTimePlayed
                    ? new Date(relevantGame.titleHistory?.lastTimePlayed)
                    : null,
                recentPlaytimeSeconds: undefined,
                totalPlaytimeSeconds: Number.parseInt(stats.value) * 60,
                totalPlayCount: existingPlaytimeInfo?.totalPlayCount ?? 0,
                firstPlayedDate: undefined,
                source: UserPlaytimeSource.XBOX,
                platformId: preferredPlatform.id,
            };

            assertPlayerSyncActive();
            playtimes.push(playtime);
        }
        await this.playtimeService.saveImported(playtimes, existing);
    }
}
