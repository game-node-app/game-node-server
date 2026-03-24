import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import {
    GAME_ACHIEVEMENT_SCHEDULER_JOB,
    GAME_ACHIEVEMENT_SYNC_QUEUE_NAME,
} from "./game-achievement-sync.constants";
import { Queue } from "bullmq";
import { Cron } from "@nestjs/schedule";

@Injectable()
export class GameAchievementSyncQueueService {
    private readonly logger = new Logger(GameAchievementSyncQueueService.name);

    constructor(
        @InjectQueue(GAME_ACHIEVEMENT_SYNC_QUEUE_NAME)
        private readonly queue: Queue,
    ) {}

    // “At minute 0 past hour 6, 12, 18, and 0.”
    @Cron("0 6,12,18,0 * * *")
    public registerSyncJobs() {}
}
