import {
    PlayerSyncStateService,
    PlayerSyncOwnershipLost,
} from "../../../sync/player-data/player-sync-state.service";
import {
    currentPlayerSyncOwner,
    recordPlayerSyncStats,
} from "../../../sync/player-sync-attempt";
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
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
        private readonly state: PlayerSyncStateService,
    ) {}

    public async addUserSyncJob(
        userId: string,
        externalGameId: number,
        source: EConnectionType,
        activityFingerprint?: string,
    ) {
        externalGameId = Number(externalGameId);
        if (!Number.isSafeInteger(externalGameId) || externalGameId <= 0)
            throw new BadRequestException("Invalid external game identity");
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
                throw new BadRequestException(
                    `Unsupported connection type: ${source}`,
                );
            });

        const connection = await this.state.findConnection(userId, source);
        if (!connection) return { status: "disconnected" };
        const parent = currentPlayerSyncOwner();
        if (
            parent &&
            (parent.connectionId !== connection.id ||
                parent.sourceUserId !== connection.sourceUserId)
        )
            throw new PlayerSyncOwnershipLost();
        const owner = await this.state.claim(
            connection.id,
            connection.sourceUserId,
            externalGameId,
            activityFingerprint,
        );
        if (!owner) {
            recordPlayerSyncStats({ gamesSkipped: 1 });
            return { status: "pending-or-cooldown" };
        }
        const result = await this.state.enqueue(owner, this.queue, jobName, {
            userId,
            externalGameId,
            activityFingerprint,
        });
        recordPlayerSyncStats({ gamesSelected: 1 });
        return result;
    }
}
