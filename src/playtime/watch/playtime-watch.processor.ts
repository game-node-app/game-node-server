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
import { match, P } from "ts-pattern";
import { ConnectionSyncGateway } from "../../connection/connection-sync/connection-sync.gateway";

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
        private readonly connectionSyncGateway: ConnectionSyncGateway,
    ) {
        super();
    }

    async process(job: Job<PlaytimeWatchJob>) {
        if (job.name === PLAYTIME_WATCH_QUEUE_JOB_NAME) {
            this.logger.log(
                `Started playtime update for ${job.data.userId} in source ${job.data.source}`,
            );
            this.connectionSyncGateway.sendMessageToUser(
                job.data.userId,
                `Started playtime update for ${job.data.userId} in source ${job.data.source}`,
            );

            switch (job.data.source) {
                case UserPlaytimeSource.STEAM:
                    return this.updateSteamPlaytimeInfo(job);
                case UserPlaytimeSource.PSN:
                    return this.updatePsnPlaytimeInfo(job);
                case UserPlaytimeSource.XBOX:
                    return this.updateXboxPlaytimeInfo(job);
                default:
                    throw new UnrecoverableError(
                        `Playtime source not supported: ${job.data.source}`,
                    );
            }
        }
    }

    @OnWorkerEvent("progress")
    async onProgress(job: Job<PlaytimeWatchJob>) {
        if (!(job.name === PLAYTIME_WATCH_QUEUE_JOB_NAME)) {
            return;
        }
        const userId = job.data.userId;
        const source = job.data.source;
        const {
            error,
            totalPlaytimeSeconds,
            totalUpdatedGames,
            gameName,
            platform,
        } = job.progress as PlaytimeWatchJobProgress;

        if (error) {
            this.logger.error(
                `Playtime update failed for user ${userId} in ${source}: ${error}`,
            );
            this.connectionSyncGateway.sendMessageToUser(
                userId,
                `[PLAYTIME] Update failed: ${error}`,
            );
            return;
        }
        if (totalUpdatedGames != undefined) {
            this.logger.log(
                `Updated ${totalUpdatedGames} games for user ${userId} in ${source}.`,
            );
            this.connectionSyncGateway.sendMessageToUser(
                userId,
                `[PLAYTIME] Updated ${totalUpdatedGames} games for user ${userId} in ${source}.`,
            );
            return;
        }

        if (gameName != undefined) {
            this.logger.log(
                `Updated playtime for game ${gameName} in platform ${platform} for user ${userId} in ${source}.`,
            );
            this.connectionSyncGateway.sendMessageToUser(
                userId,
                `[PLAYTIME] Updated playtime for ${gameName} in platform ${platform}: ${totalPlaytimeSeconds} seconds.`,
            );
        }

        if (totalUpdatedGames != undefined) {
            this.logger.log(
                `Updated ${totalUpdatedGames} games for user ${userId} in ${source}.`,
            );
            this.connectionSyncGateway.sendMessageToUser(
                userId,
                `[PLAYTIME] Updated ${totalUpdatedGames} games for user ${userId} in ${source}.`,
            );
            return;
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
        this.connectionSyncGateway.sendMessageToUser(
            userId,
            `[PLAYTIME] Update failed: ${failedReason}`,
        );
    }

    async updateSteamPlaytimeInfo(job: Job<PlaytimeWatchJob>) {
        const userId = job.data.userId;

        const connection =
            await this.connectionsService.findOneByUserIdAndTypeOrFail(
                userId,
                EConnectionType.STEAM,
            );

        const userGames = await this.steamSyncService.getAllGames(
            connection.sourceUserId,
        );

        if (userGames.length === 0) {
            job.updateProgress({
                error: "No games found for Steam. Your library may be set to private.",
            } satisfies PlaytimeWatchJobProgress);
            return;
        }

        const gamesUids = userGames.map((item) => `${item.game.id}`);

        const externalGames =
            await this.externalGameService.getExternalGamesForSourceIds(
                gamesUids,
                EGameExternalGameCategory.Steam,
            );

        const unmappedEntries = userGames.filter((userGame) => {
            return !externalGames.some(
                (externalGame) => externalGame.uid === `${userGame.game.id}`,
            );
        });

        for (const unmappedEntry of unmappedEntries) {
            await this.externalGameService.registerUnmappedGame(
                `${unmappedEntry.game.id}`,
                EGameExternalGameCategory.Steam,
            );
        }

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

        for (const [gameId, items] of groupedByGameId.entries()) {
            const appIds = items.map((item) => Number.parseInt(item.uid));

            const relatedUserGames = userGames.filter((userGame) => {
                return appIds.includes(userGame.game.id);
            });

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

            const existingPlaytimeInfo = await this.playtimeService.findOne(
                userId,
                gameId,
                UserPlaytimeSource.STEAM,
                PC_PLATFORM_ID,
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
                playtime.totalPlayCount! += 1;
            }

            job.updateProgress({
                gameName: items[0].name,
                platform: "PC",
                totalPlaytimeSeconds: totalPlaytimeSeconds,
            } satisfies PlaytimeWatchJobProgress);
            await this.playtimeService.save(playtime);
        }

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

        if (userGames.length === 0) {
            job.updateProgress({
                error: "No games found for PSN. Your library may be set to private.",
            });
            return;
        }

        const gamesUids = userGames.map((item) => `${item.concept.id}`);

        const externalGames =
            await this.externalGameService.getExternalGamesForSourceIds(
                gamesUids,
                EGameExternalGameCategory.PlaystationStoreUs,
            );

        const unmappedEntries = userGames.filter((userGame) => {
            return !externalGames.some(
                (externalGame) => externalGame.uid === `${userGame.concept.id}`,
            );
        });

        for (const unmappedEntry of unmappedEntries) {
            this.externalGameService
                .registerUnmappedGame(
                    `${unmappedEntry.concept.id}`,
                    EGameExternalGameCategory.PlaystationStoreUs,
                )
                .catch((err) => this.logger.error(err));
        }

        /**
         * Names are not unique across platforms, so we can use this logic to group all related playtime info for a single game
         * across PS4 and PS5.
         */
        const groupedByName = Map.groupBy(userGames, (item) => item.name);

        const platformsMap =
            await this.gameRepositoryService.getGamePlatformsMap(
                "abbreviation",
            );

        for (const [name, titles] of groupedByName.entries()) {
            // First matching external game
            const relatedExternalGame = externalGames.find((externalGame) => {
                return titles.some(
                    (title) =>
                        title.concept.id === Number.parseInt(externalGame.uid),
                );
            });

            if (!relatedExternalGame) {
                continue;
            }

            // Matching is imprecise
            const relatedTrophyTitles = userTrophyTitles.filter(
                (trophyTitle) => trophyTitle.trophyTitleName === name,
            );

            for (const trophyTitle of relatedTrophyTitles) {
                this.externalGameMappingsService
                    .upsertPsnMappings({
                        externalGameId: relatedExternalGame.id,
                        npServiceName: trophyTitle.npServiceName,
                        npCommunicationId: trophyTitle.npCommunicationId,
                    })
                    .catch((err) => this.logger.error(err));
            }

            for (const title of titles) {
                const targetPlatform = match(title.category)
                    .with("ps5_native_game", () => platformsMap.get("PS5")!)
                    .with("ps4_game", () => platformsMap.get("PS4")!)
                    .with("pspc_game", () => platformsMap.get("PSP")!)
                    .otherwise(() => platformsMap.get("PS3")!);

                const existingPlaytimeInfo = await this.playtimeService.findOne(
                    userId,
                    relatedExternalGame.gameId,
                    UserPlaytimeSource.PSN,
                    targetPlatform.id,
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
                    // Recent playtime will be calculated on our side
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
                await this.playtimeService.save(playtime);
            }
        }

        job.updateProgress({
            totalUpdatedGames: groupedByName.size,
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

        if (allGames.length === 0) {
            job.updateProgress({
                error: "No games found for Xbox. Your library may be set to private.",
            });
            return;
        }

        const sourceUids = allGames.map((game) => game.productId);

        const externalGames =
            await this.externalGameService.getExternalGamesForSourceIds(
                sourceUids,
                EGameExternalGameCategory.Microsoft,
            );

        const relevantTitleIds = allGames
            // Get only games with matches
            .filter((game) =>
                externalGames.some(
                    (externalGame) => externalGame.uid === game.productId,
                ),
            )
            .map((game) => game.titleId);

        // A small portion of the items may not have stats, and some will not have the 'value' defined anyway.
        const playtimeStats = await this.xboxSyncService.getBatchMinutesPlayed(
            connection.sourceUserId,
            relevantTitleIds,
        );

        const platformsMap =
            await this.gameRepositoryService.getGamePlatformsMap(
                "abbreviation",
            );

        for (const stats of playtimeStats) {
            if (stats.value == undefined) continue;

            const relevantGame = allGames.find(
                (game) => game.titleId === stats.titleid,
            )!;
            const relevantExternalGame = externalGames.find(
                (externalGame) => externalGame.uid === relevantGame.productId,
            )!;

            const playedPlatforms = relevantGame.devices.map((device) => {
                return match(device)
                    .with(P.union("PC", "Win32"), () => platformsMap.get("PC")!)
                    .with("Xbox360", () => platformsMap.get("X360")!)
                    .with("XboxOne", () => platformsMap.get("XONE")!)
                    .with("XboxSeries", () => platformsMap.get("Series X|S")!)
                    .otherwise(() => platformsMap.get("Series X|S")!);
            });

            for (const platform of playedPlatforms) {
                const existingPlaytimeInfo = await this.playtimeService.findOne(
                    userId,
                    relevantExternalGame.gameId,
                    UserPlaytimeSource.XBOX,
                    platform.id,
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
                    totalPlayCount: 0,
                    firstPlayedDate: undefined,
                    source: UserPlaytimeSource.XBOX,
                    platformId: platform.id,
                };

                const hasChangedTotalPlaytime =
                    existingPlaytimeInfo != undefined &&
                    existingPlaytimeInfo.totalPlaytimeSeconds !=
                        playtime.totalPlaytimeSeconds;

                if (hasChangedTotalPlaytime) {
                    playtime.totalPlayCount =
                        existingPlaytimeInfo!.totalPlayCount + 1;
                }

                job.updateProgress({
                    gameName: relevantExternalGame.name,
                    platform: platform.abbreviation,
                    totalPlaytimeSeconds: playtime.totalPlaytimeSeconds,
                } satisfies PlaytimeWatchJobProgress);

                await this.playtimeService.save(playtime);
            }
        }

        job.updateProgress({
            totalUpdatedGames: allGames.length,
        } satisfies PlaytimeWatchJobProgress);
    }
}
