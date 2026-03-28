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
import { ObtainedGameAchievement } from "../entity/obtained-game-achievement.entity";
import { ObtainedGameAchievementActivity } from "../entity/obtained-game-achievement-activity.entity";
import { GameAchievementService } from "../game-achievement.service";
import {
    checkIfGameIsComplete,
    checkIfGameIsPlatinum,
} from "../game-achievement.utils";
import { GameAchievementActivityService } from "../game-achievement-activity.service";
import { GameObtainedAchievementDto } from "../dto/game-obtained-achievement.dto";

@Processor(GAME_ACHIEVEMENT_SYNC_QUEUE_NAME)
export class GameAchievementSyncProcessor extends WorkerHostProcessor {
    logger = new Logger(GameAchievementSyncProcessor.name);

    constructor(
        private readonly gameAchievementService: GameAchievementService,
        private readonly obtainedAchievementService: GameAchievementObtainedService,
        private readonly gameAchievementActivityService: GameAchievementActivityService,
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

        const actuallyObtainedAchievementsInGame =
            obtainedAchievementsInGame.filter(
                (a) => a.isObtained && a.obtainedAt != null,
            );

        this.logger.log(
            `Found ${obtainedAchievementsInGame.length} obtained achievements for user ${userId} and external game ${externalGameId}`,
        );

        const persistedEntities =
            await this.obtainedAchievementService.persistObtainedAchievements(
                userId,
                actuallyObtainedAchievementsInGame,
            );

        if (persistedEntities.length === 0) {
            this.logger.log(
                `No new obtained achievements to persist for user ${userId} and external game ${externalGameId}`,
            );

            return;
        }

        this.logger.log(
            `Persisted ${persistedEntities.length} obtained achievements for user ${userId} and external game ${externalGameId}`,
        );

        await this.handleActivityCreate(
            jobData,
            actuallyObtainedAchievementsInGame,
            persistedEntities,
        );
    }

    private async handleActivityCreate(
        jobData: GameAchievementObtainedUpdateJob,
        allObtainedAchievements: GameObtainedAchievementDto[],
        newlyPersistedEntries: ObtainedGameAchievement[],
    ) {
        const { userId, externalGameId } = jobData;

        const gameAchievements =
            await this.gameAchievementService.findAllByExternalGameId(
                externalGameId,
            );

        if (gameAchievements.length === 0) {
            this.logger.log(
                `No game achievements found for external game ${externalGameId}, skipping activity creation`,
            );
            return;
        }

        /**
         * Check if game is complete, including all obtained achievements for the game,
         * not just the ones obtained in this sync.
         * PS: We don't have a reliable way to determine if a game is completed without checking all achievements
         * that works across all platforms.
         */
        const isComplete = checkIfGameIsComplete(
            gameAchievements,
            allObtainedAchievements,
        );

        /**
         * Check if newly obtained achievements in this sync include the platinum trophy, if the game has one.
         */
        const isPlatinum = checkIfGameIsPlatinum(
            gameAchievements,
            newlyPersistedEntries.map((e) => ({
                externalId: e.externalAchievementId,
            })),
        );

        const activityEntity: Partial<ObtainedGameAchievementActivity> = {
            profileUserId: userId,
            externalGameId,
            totalObtained: newlyPersistedEntries.length,
            hasCompletedAllAchievements: isComplete,
            hasObtainedPlatinumTrophy: isPlatinum,
            obtainedGameAchievements: newlyPersistedEntries,
        };

        await this.gameAchievementActivityService.save(activityEntity);
    }
}
