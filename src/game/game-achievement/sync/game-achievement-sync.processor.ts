import { recordPlayerSyncStats } from "../../../sync/player-sync-attempt";
import { EConnectionType } from "../../../connection/connections.constants";
import {
    PlayerSyncStateService,
    PlayerSyncOwnershipLost,
} from "../../../sync/player-data/player-sync-state.service";
import {
    providerFailure,
    ProviderSyncError,
} from "../../../sync/provider-sync.error";
import {
    PlayerSyncAttempt,
    assertPlayerSyncActive,
} from "../../../sync/player-sync-attempt";
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
import { GameObtainedAchievementService } from "../game-obtained-achievement.service";
import { Processor } from "@nestjs/bullmq";
import { ObtainedGameAchievement } from "../entity/obtained-game-achievement.entity";
import { ObtainedGameAchievementActivity } from "../entity/obtained-game-achievement-activity.entity";
import { GameAchievementService } from "../game-achievement.service";
import {
    checkIfGameIsComplete,
    checkIfGameIsPlatinum,
} from "../game-achievement.utils";
import { GameAchievementActivityService } from "../game-achievement-activity.service";
import { GameObtainedAchievementDto } from "../dto/game-obtained-achievement.dto";
import { GameAchievementStatusService } from "../game-achievement-status.service";
import { UnsupportedGameAchievementSourceError } from "../game-achievement.errors";
import { DataSource, EntityManager } from "typeorm";

@Processor(GAME_ACHIEVEMENT_SYNC_QUEUE_NAME)
export class GameAchievementSyncProcessor extends WorkerHostProcessor {
    logger = new Logger(GameAchievementSyncProcessor.name);

    constructor(
        private readonly gameAchievementService: GameAchievementService,
        private readonly obtainedAchievementService: GameObtainedAchievementService,
        private readonly gameAchievementActivityService: GameAchievementActivityService,
        private readonly gameAchievementStatusService: GameAchievementStatusService,
        private readonly state: PlayerSyncStateService,
        private readonly dataSource: DataSource,
    ) {
        super();
    }

    @PlayerSyncAttempt()
    async process(job: Job<GameAchievementObtainedUpdateJob>) {
        const VALID_JOBS = [
            GAME_ACHIEVEMENT_STEAM_JOB_NAME,
            GAME_ACHIEVEMENT_XBOX_JOB_NAME,
            GAME_ACHIEVEMENT_PLAYSTATION_JOB_NAME,
        ];

        if (VALID_JOBS.includes(job.name)) {
            const expectedSource =
                job.name === GAME_ACHIEVEMENT_STEAM_JOB_NAME
                    ? EConnectionType.STEAM
                    : job.name === GAME_ACHIEVEMENT_PLAYSTATION_JOB_NAME
                      ? EConnectionType.PSN
                      : EConnectionType.XBOX;
            const owner = job.data.owner;
            if (!owner) return { outcome: "legacy-skip" };
            if (
                owner.userId !== job.data.userId ||
                owner.source !== expectedSource ||
                owner.externalGameId !== job.data.externalGameId
            )
                throw new UnrecoverableError(
                    "Invalid achievement job identity",
                );
            try {
                return await this.state.runOwned(owner, () =>
                    this.handleSync(job.data, owner),
                );
            } catch (error) {
                if (error instanceof PlayerSyncOwnershipLost)
                    return { outcome: "stale-skip" };
                if (
                    error instanceof UnsupportedGameAchievementSourceError ||
                    (error instanceof ProviderSyncError &&
                        error.outcome === "unsupported")
                ) {
                    await this.state.completeGame(
                        owner,
                        "unsupported",
                        job.data.activityFingerprint ?? null,
                    );
                    return { outcome: "unsupported" };
                }
                if (job.attemptsMade + 1 >= (job.opts?.attempts ?? 1))
                    await this.state.finish(
                        owner,
                        providerFailure("Player", error),
                    );
                throw error;
            }
        }

        throw new UnrecoverableError("Invalid job name: " + job.name);
    }

    private async handleSync(
        jobData: GameAchievementObtainedUpdateJob,
        owner: NonNullable<GameAchievementObtainedUpdateJob["owner"]>,
    ) {
        const { userId, externalGameId } = jobData;

        this.logger.log(
            `Processing sync for user ${userId} and external game ${externalGameId}`,
        );

        recordPlayerSyncStats({ gamesSeen: 1 });
        const [obtainedAchievementsInGame, gameAchievements] =
            await Promise.all([
                this.obtainedAchievementService.fetchObtainedByExternalGameId(
                    userId,
                    externalGameId,
                ),
                this.gameAchievementService.findAllByExternalGameIdForSync(
                    externalGameId,
                ),
            ]);

        const actuallyObtainedAchievementsInGame =
            obtainedAchievementsInGame.filter(
                (a) => a.isObtained && a.obtainedAt != null,
            );

        this.logger.log(
            `Found ${obtainedAchievementsInGame.length} obtained achievements for user ${userId} and external game ${externalGameId}`,
        );

        const outcome =
            obtainedAchievementsInGame.length === 0 ? "empty" : "complete";
        assertPlayerSyncActive();
        const runner = this.dataSource.createQueryRunner();
        let lockAcquired = false;
        let activity:
            | Awaited<ReturnType<GameAchievementActivityService["save"]>>
            | undefined;
        // MySQL named-lock identifiers are limited to 64 characters.
        const lockName = `ga:${userId}:${externalGameId}`;
        try {
            await runner.connect();
            const [lock] = await runner.query(
                "SELECT GET_LOCK(?, 30) AS acquired",
                [lockName],
            );
            if (Number(lock?.acquired) !== 1)
                throw new ProviderSyncError(
                    "failed",
                    "Could not acquire the game achievement commit lock",
                );
            lockAcquired = true;
            await runner.startTransaction();

            const manager = runner.manager;
            const persistedEntities =
                await this.obtainedAchievementService.persistObtainedAchievements(
                    userId,
                    actuallyObtainedAchievementsInGame,
                    manager,
                );

            await this.gameAchievementStatusService.updateGameCompletionStatus(
                userId,
                externalGameId,
                gameAchievements,
                actuallyObtainedAchievementsInGame,
                manager,
            );

            if (persistedEntities.length === 0) {
                this.logger.log(
                    `No new obtained achievements to persist for user ${userId} and external game ${externalGameId}`,
                );
            } else {
                this.logger.log(
                    `Persisted ${persistedEntities.length} obtained achievements for user ${userId} and external game ${externalGameId}`,
                );
            }

            activity = persistedEntities.length
                ? await this.handleActivityCreate(
                      jobData,
                      gameAchievements,
                      actuallyObtainedAchievementsInGame,
                      persistedEntities,
                      manager,
                  )
                : undefined;

            await this.state.completeGame(
                owner,
                outcome,
                jobData.activityFingerprint ?? null,
                manager,
            );
            assertPlayerSyncActive();
            await runner.commitTransaction();
            recordPlayerSyncStats({
                gamesChanged: persistedEntities.length ? 1 : 0,
                stagesSucceeded: 1,
            });
        } catch (error) {
            if (runner.isTransactionActive) await runner.rollbackTransaction();
            throw error;
        } finally {
            try {
                if (lockAcquired)
                    await runner.query("SELECT RELEASE_LOCK(?)", [lockName]);
            } finally {
                await runner.release();
            }
        }

        if (activity) {
            try {
                await this.gameAchievementActivityService.publish(activity);
            } catch {
                this.logger.error(
                    `Failed to publish achievement activity ${activity.id}; delivery remains pending`,
                );
            }
        }
        return outcome;
    }

    private async handleActivityCreate(
        jobData: GameAchievementObtainedUpdateJob,
        gameAchievements: Awaited<
            ReturnType<GameAchievementService["findAllByExternalGameIdForSync"]>
        >,
        allObtainedAchievements: GameObtainedAchievementDto[],
        newlyPersistedEntries: ObtainedGameAchievement[],
        manager: EntityManager,
    ) {
        const { userId, externalGameId } = jobData;

        if (gameAchievements.length === 0) {
            this.logger.log(
                `No game achievements found for external game ${externalGameId}, skipping activity creation`,
            );
            return undefined;
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

        assertPlayerSyncActive();
        return this.gameAchievementActivityService.save(
            activityEntity,
            manager,
        );
    }
}
