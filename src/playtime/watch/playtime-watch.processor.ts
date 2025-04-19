import { Processor } from "@nestjs/bullmq";
import {
    PLAYTIME_WATCH_QUEUE_JOB_NAME,
    PLAYTIME_WATCH_QUEUE_NAME,
    PlaytimeWatchJob,
} from "./playtime-watch.constants";
import { seconds } from "@nestjs/throttler";
import { WorkerHostProcessor } from "../../utils/WorkerHostProcessor";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { ConnectionsService } from "../../connections/connections.service";
import { EConnectionType } from "../../connections/connections.constants";
import { SteamSyncService } from "../../sync/steam/steam-sync.service";
import { PsnSyncService } from "../../sync/psn/psn-sync.service";
import { ExternalGameService } from "../../game/game-repository/external-game/external-game.service";
import { EGameExternalGameCategory } from "../../game/game-repository/game-repository.constants";
import { PlaytimeService } from "../playtime.service";
import { UserPlaytimeSource } from "../playtime.constants";
import dayjs from "dayjs";
import { CreateUserPlaytimeDto } from "../dto/create-user-playtime.dto";

@Processor(PLAYTIME_WATCH_QUEUE_NAME, {
    limiter: {
        max: 1,
        duration: seconds(5),
    },
})
export class PlaytimeWatchProcessor extends WorkerHostProcessor {
    logger = new Logger(PlaytimeWatchProcessor.name);

    constructor(
        private readonly playtimeService: PlaytimeService,
        private readonly connectionsService: ConnectionsService,
        private readonly externalGameService: ExternalGameService,
        private readonly steamSyncService: SteamSyncService,
        private readonly psnSyncService: PsnSyncService,
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

        for (const externalGame of externalGames) {
            const relatedUserGame = userGames.find((item) => {
                return Number.parseInt(externalGame.uid) === item.game.id;
            })!;

            const existingPlaytimeInfo =
                await this.playtimeService.findOneByExternalGame(
                    userId,
                    externalGame.id,
                );

            const playtime: CreateUserPlaytimeDto = {
                ...existingPlaytimeInfo,
                source: UserPlaytimeSource.STEAM,
                gameId: externalGame.gameId,
                externalGameId: externalGame.id,
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

        const userGames = await this.psnSyncService.getAllGames(
            connection.sourceUserId,
        );

        const gamesUids = userGames.map((item) => `${item.concept.id}`);

        const externalGames =
            await this.externalGameService.getExternalGamesForSourceIds(
                gamesUids,
                EGameExternalGameCategory.PlaystationStoreUs,
            );

        for (const externalGame of externalGames) {
            const relatedUserGame = userGames.find((item) => {
                return Number.parseInt(externalGame.uid) === item.concept.id;
            })!;

            const existingPlaytimeInfo =
                await this.playtimeService.findOneByExternalGame(
                    userId,
                    externalGame.id,
                );

            const playtime: CreateUserPlaytimeDto = {
                ...existingPlaytimeInfo,
                source: UserPlaytimeSource.PSN,
                gameId: externalGame.gameId,
                externalGameId: externalGame.id,
                firstPlayedDate: new Date(relatedUserGame.firstPlayedDateTime),
                lastPlayedDate: new Date(relatedUserGame.lastPlayedDateTime),
                profileUserId: userId,
                totalPlaytimeSeconds: dayjs
                    .duration(relatedUserGame.playDuration)
                    .asSeconds(),
                recentPlaytimeSeconds: 0,
                totalPlayCount: relatedUserGame.playCount,
            };

            await this.playtimeService.save(playtime);
        }
    }
}
