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
import { UserPlaytime } from "../entity/user-playtime.entity";
import { UserPlaytimeSource } from "../playtime.constants";
import dayjs from "dayjs";
import { DeepPartial } from "typeorm";

const hasChanged = (
    existingPlaytime: UserPlaytime | null | undefined,
    currentPlaytime: DeepPartial<UserPlaytime>,
) => {
    const comparableProperties: (keyof UserPlaytime)[] = [
        "firstPlayedDate",
        "lastPlayedDate",
        "totalPlayCount",
        "totalPlaytimeSeconds",
        "recentPlaytimeSeconds",
    ];

    if (existingPlaytime == undefined) return true;

    return comparableProperties.some((property) => {
        // If property is null and is now available in the updated entry
        if (
            existingPlaytime[property] == undefined &&
            currentPlaytime[property] != undefined
        ) {
            return true;
        }

        // Property is not null - check if it's different from the updated one
        return (
            existingPlaytime[property] != undefined &&
            existingPlaytime[property] !== currentPlaytime[property]
        );
    });
};

@Processor(PLAYTIME_WATCH_QUEUE_NAME, {
    limiter: {
        max: 1,
        duration: seconds(2),
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
                `Started playtime update for ${job.data.userId} in source ${job.data.source} at ${new Date().toISOString()}`,
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

            const playtime: DeepPartial<UserPlaytime> = {
                ...existingPlaytimeInfo,
                lastPlayedDate: relatedUserGame.lastPlayedAt,
                totalPlaytimeSeconds: relatedUserGame.minutes * 60,
                recentPlaytimeSeconds: relatedUserGame.recentMinutes * 60,
                gameId: externalGame.gameId,
                firstPlayedDate: undefined,
                profileUserId: userId,
                externalGameId: externalGame.id,
            };

            if (hasChanged(existingPlaytimeInfo, playtime)) {
                playtime.totalPlayCount = playtime.totalPlayCount
                    ? playtime.totalPlayCount + 1
                    : 0;

                await this.playtimeService.save(playtime);
            }
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
                EGameExternalGameCategory.Steam,
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

            const playtime: DeepPartial<UserPlaytime> = {
                ...existingPlaytimeInfo,
                gameId: externalGame.gameId,
                firstPlayedDate: new Date(relatedUserGame.firstPlayedDateTime),
                lastPlayedDate: new Date(relatedUserGame.lastPlayedDateTime),
                profileUserId: userId,
                totalPlaytimeSeconds: dayjs
                    .duration(relatedUserGame.playDuration)
                    .asSeconds(),
                externalGameId: externalGame.id,
            };

            if (hasChanged(existingPlaytimeInfo, playtime)) {
                let totalPlaytimeDifference = 0;
                if (existingPlaytimeInfo) {
                    totalPlaytimeDifference =
                        existingPlaytimeInfo.totalPlaytimeSeconds -
                        playtime.totalPlaytimeSeconds!;
                }

                playtime.recentPlaytimeSeconds = totalPlaytimeDifference;
                await this.playtimeService.save(playtime);
            }
        }
    }
}
