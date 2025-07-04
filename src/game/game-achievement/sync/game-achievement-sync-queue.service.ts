import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { GAME_ACHIEVEMENT_SYNC_QUEUE_NAME } from "./game-achievement-sync.constants";
import { Queue } from "bullmq";

@Injectable()
export class GameAchievementSyncQueueService {
    private readonly logger = new Logger(GameAchievementSyncQueueService.name);

    constructor(
        @InjectQueue(GAME_ACHIEVEMENT_SYNC_QUEUE_NAME)
        private readonly queue: Queue,
    ) {}
}
