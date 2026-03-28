import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import {
    GAME_ACHIEVEMENT_PLAYSTATION_JOB_NAME,
    GAME_ACHIEVEMENT_STEAM_JOB_NAME,
    GAME_ACHIEVEMENT_SYNC_QUEUE_NAME,
    GAME_ACHIEVEMENT_XBOX_JOB_NAME,
    GameAchievementObtainedUpdateJob,
} from "./game-achievement-sync.constants";
import { Queue } from "bullmq";
import { EConnectionType } from "../../../connection/connections.constants";
import { match } from "ts-pattern";

@Injectable()
export class GameAchievementSyncQueueService {
    private readonly logger = new Logger(GameAchievementSyncQueueService.name);

    constructor(
        @InjectQueue(GAME_ACHIEVEMENT_SYNC_QUEUE_NAME)
        private readonly queue: Queue,
    ) {}

    public addUserSyncJob(
        userId: string,
        externalGameId: number,
        source: EConnectionType,
        lastPlayedAt?: Date,
    ) {
        this.logger.log(
            `Adding user sync job for user ${userId} and game ${externalGameId}`,
        );

        const jobName = match(source)
            .with(EConnectionType.XBOX, () => GAME_ACHIEVEMENT_XBOX_JOB_NAME)
            .with(
                EConnectionType.PSN,
                () => GAME_ACHIEVEMENT_PLAYSTATION_JOB_NAME,
            )
            .with(EConnectionType.STEAM, () => GAME_ACHIEVEMENT_STEAM_JOB_NAME)
            .otherwise(() => {
                this.logger.error(`Unsupported connection type: ${source}`);
                throw new Error(`Unsupported connection type: ${source}`);
            });

        this.queue
            .add(jobName, {
                userId,
                externalGameId,
                lastPlayedAt,
            } satisfies GameAchievementObtainedUpdateJob)
            .catch((err) => {
                this.logger.error(err, err.stack);
            });
    }
}
