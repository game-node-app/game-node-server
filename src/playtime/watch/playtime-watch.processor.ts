import { Processor } from "@nestjs/bullmq";
import {
    PLAYTIME_WATCH_QUEUE_JOB_NAME,
    PLAYTIME_WATCH_QUEUE_NAME,
    PlaytimeWatchJob,
} from "./playtime-watch.constants";
import { WorkerHostProcessor } from "../../utils/WorkerHostProcessor";
import { Logger } from "@nestjs/common";
import { Job, UnrecoverableError } from "bullmq";
import { ConnectionsService } from "../../connections/connections.service";
import { EConnectionType } from "../../connections/connections.constants";
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

@Processor(PLAYTIME_WATCH_QUEUE_NAME, {
    concurrency: 1,
    limiter:
        process.env.NODE_ENV === "development"
            ? {
                  max: 1,
                  duration: seconds(30),
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
    ) {
        super();
    }

    async process(job: Job<PlaytimeWatchJob>) {
        if (job.name === PLAYTIME_WATCH_QUEUE_JOB_NAME) {
            this.logger.log(
                `Started playtime update for ${job.data.userId} in source ${job.data.source}`,
            );
            switch (job.data.source) {
                case UserPlaytimeSource.STEAM:
                    return this.updateSteamPlaytimeInfo(job.data.userId);
                case UserPlaytimeSource.PSN:
                    return this.updatePsnPlaytimeInfo(job.data.userId);
                case UserPlaytimeSource.XBOX:
                    return this.updateXboxPlaytimeInfo(job.data.userId);
                default:
                    throw new UnrecoverableError(
                        `Playtime source not supported: ${job.data.source}`,
                    );
            }
        }
    }

    async updateSteamPlaytimeInfo(userId: string) {
        const connection =
            await this.connectionsService.findOneByUserIdAndTypeOrFail(
                userId,
                EConnectionType.STEAM,
            );

        const userGames = await this.steamSyncService.getAllGames(
            connection.sourceUserId,
        );

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

        for (const externalGame of externalGames) {
            const relatedUserGame = userGames.find((item) => {
                return Number.parseInt(externalGame.uid) === item.game.id;
            })!;

            const existingPlaytimeInfo =
                await this.playtimeService.findOneBySource(
                    userId,
                    externalGame.gameId,
                    UserPlaytimeSource.STEAM,
                );

            const playtime: CreateUserPlaytimeDto = {
                ...existingPlaytimeInfo,
                source: UserPlaytimeSource.STEAM,
                gameId: externalGame.gameId,
                profileUserId: userId,
                lastPlayedDate: relatedUserGame.lastPlayedTimestamp
                    ? new Date(relatedUserGame.lastPlayedTimestamp * 1000)
                    : null,
                totalPlaytimeSeconds: relatedUserGame.minutes * 60,
                recentPlaytimeSeconds: relatedUserGame.recentMinutes * 60,
                totalPlayCount: 0,
                firstPlayedDate: undefined,
            };

            const hasChangedTotalPlaytime =
                existingPlaytimeInfo != undefined &&
                existingPlaytimeInfo.totalPlaytimeSeconds !=
                    playtime.totalPlaytimeSeconds;

            if (hasChangedTotalPlaytime) {
                playtime.totalPlayCount =
                    existingPlaytimeInfo!.totalPlayCount + 1;
            }

            await this.playtimeService.save(playtime);
        }
    }

    async updatePsnPlaytimeInfo(userId: string) {
        const connection =
            await this.connectionsService.findOneByUserIdAndTypeOrFail(
                userId,
                EConnectionType.PSN,
            );

        const [userGames, userTrophyTitles] = await Promise.all([
            this.psnSyncService.getAllGames(connection.sourceUserId),
            this.psnSyncService.getUserTrophyTitles(connection.sourceUserId),
        ]);

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

        for (const externalGame of externalGames) {
            const relatedUserGame = userGames.find((item) => {
                return Number.parseInt(externalGame.uid) === item.concept.id;
            })!;

            // Matching is imprecise
            const relatedTrophyTitle = userTrophyTitles.find(
                (trophyTitle) =>
                    trophyTitle.trophyTitleName === relatedUserGame.name &&
                    relatedUserGame.category.includes(
                        trophyTitle.trophyTitlePlatform.toLocaleLowerCase(),
                    ),
            );

            if (relatedTrophyTitle) {
                this.externalGameMappingsService
                    .upsertPsnMappings({
                        externalGameId: externalGame.id,
                        npServiceName: relatedTrophyTitle.npServiceName,
                        npCommunicationId: relatedTrophyTitle.npCommunicationId,
                    })
                    .catch((err) => this.logger.error(err));
            }

            const existingPlaytimeInfo =
                await this.playtimeService.findOneBySource(
                    userId,
                    externalGame.gameId,
                    UserPlaytimeSource.PSN,
                );

            const playtime: CreateUserPlaytimeDto = {
                ...existingPlaytimeInfo,
                source: UserPlaytimeSource.PSN,
                gameId: externalGame.gameId,
                firstPlayedDate: new Date(relatedUserGame.firstPlayedDateTime),
                lastPlayedDate: new Date(relatedUserGame.lastPlayedDateTime),
                profileUserId: userId,
                totalPlaytimeSeconds: dayjs
                    .duration(relatedUserGame.playDuration)
                    .asSeconds(),
                // Recent playtime will be calculated on our side
                recentPlaytimeSeconds: undefined,
                totalPlayCount: relatedUserGame.playCount,
            };

            await this.playtimeService.save(playtime);
        }
    }

    async updateXboxPlaytimeInfo(userId: string) {
        const connection =
            await this.connectionsService.findOneByUserIdAndTypeOrFail(
                userId,
                EConnectionType.XBOX,
            );

        const allGames = await this.xboxSyncService.getAllGames(
            connection.sourceUserId,
        );

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

        for (const stats of playtimeStats) {
            if (stats.value == undefined) continue;

            const relevantGame = allGames.find(
                (game) => game.titleId === stats.titleid,
            )!;
            const relevantExternalGame = externalGames.find(
                (externalGame) => externalGame.uid === relevantGame.productId,
            )!;

            const existingPlaytimeInfo =
                await this.playtimeService.findOneBySource(
                    userId,
                    relevantExternalGame.gameId,
                    UserPlaytimeSource.XBOX,
                );

            const playtime: CreateUserPlaytimeDto = {
                ...existingPlaytimeInfo,
                source: UserPlaytimeSource.XBOX,
                gameId: relevantExternalGame.gameId,
                profileUserId: userId,
                lastPlayedDate: relevantGame.titleHistory?.lastTimePlayed
                    ? new Date(relevantGame.titleHistory?.lastTimePlayed)
                    : null,
                recentPlaytimeSeconds: undefined,
                totalPlaytimeSeconds: Number.parseInt(stats.value) * 60,
                totalPlayCount: 0,
                firstPlayedDate: undefined,
            };

            const hasChangedTotalPlaytime =
                existingPlaytimeInfo != undefined &&
                existingPlaytimeInfo.totalPlaytimeSeconds !=
                    playtime.totalPlaytimeSeconds;

            if (hasChangedTotalPlaytime) {
                playtime.totalPlayCount =
                    existingPlaytimeInfo!.totalPlayCount + 1;
            }

            await this.playtimeService.save(playtime);
        }
    }
}
