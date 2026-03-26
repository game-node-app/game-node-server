import { WorkerHostProcessor } from "../../../utils/WorkerHostProcessor";
import { Logger } from "@nestjs/common";
import { Job, UnrecoverableError } from "bullmq";
import {
    GAME_ACHIEVEMENT_PLAYSTATION_JOB_NAME,
    GAME_ACHIEVEMENT_STEAM_JOB_NAME,
    GAME_ACHIEVEMENT_SYNC_QUEUE_NAME,
    GAME_ACHIEVEMENT_XBOX_JOB_NAME,
    GameAchievementObtainedUpdateJob,
} from "./game-achievement-sync.constants";
import { GameAchievementObtainedService } from "../game-achievement-obtained.service";
import { Processor } from "@nestjs/bullmq";
import dayjs from "dayjs";

@Processor(GAME_ACHIEVEMENT_SYNC_QUEUE_NAME)
export class GameAchievementSyncProcessor extends WorkerHostProcessor {
    logger = new Logger(GameAchievementSyncProcessor.name);

    constructor(
        private readonly obtainedAchievementService: GameAchievementObtainedService,
    ) {
        super();
    }

    async process(job: Job<GameAchievementObtainedUpdateJob>) {
        const VALID_JOBS = [
            GAME_ACHIEVEMENT_STEAM_JOB_NAME,
            GAME_ACHIEVEMENT_XBOX_JOB_NAME,
            GAME_ACHIEVEMENT_PLAYSTATION_JOB_NAME,
        ];

        if (VALID_JOBS.includes(job.name)) {
            await this.handleSync(job.data);
            return;
        }

        throw new UnrecoverableError("Invalid job name: " + job.name);
    }

    private async handleSync(jobData: GameAchievementObtainedUpdateJob) {
        const { userId, externalGameId, lastPlayedAt } = jobData;

        if (lastPlayedAt != null) {
            const existsForUserAndGame =
                await this.obtainedAchievementService.existsForExternalGameId(
                    userId,
                    externalGameId,
                );
            const lastPlayedAtDate = dayjs(lastPlayedAt);
            const now = dayjs();
            const diffInDays = now.diff(lastPlayedAtDate, "days");

            const isOlderThanTwoWeeks = diffInDays > 14;

            if (existsForUserAndGame && isOlderThanTwoWeeks) {
                this.logger.log(
                    `Skipping sync for user ${userId} and external game ${externalGameId} because last played date is older than two weeks and achievements already exist`,
                );
                return;
            }
        }

        this.logger.log(
            `Processing sync for user ${userId} and external game ${externalGameId}`,
        );

        const obtainedAchievementsInGame =
            await this.obtainedAchievementService.findAllObtainedByExternalGameId(
                userId,
                externalGameId,
            );

        this.logger.log(
            `Found ${obtainedAchievementsInGame.length} obtained achievements for user ${userId} and external game ${externalGameId}`,
        );

        const persistedCount =
            await this.obtainedAchievementService.persistObtainedAchievements(
                userId,
                obtainedAchievementsInGame,
            );

        this.logger.log(
            `Persisted ${persistedCount} obtained achievements for user ${userId} and external game ${externalGameId}`,
        );
    }
}
