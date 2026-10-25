import { playerSyncWrite } from "../../sync/player-sync-attempt";
import { InjectRepository } from "@nestjs/typeorm";
import { ObtainedGameAchievementActivity } from "./entity/obtained-game-achievement-activity.entity";
import { EntityManager, Repository } from "typeorm";
import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { ActivitiesQueueService } from "../../activities/activities-queue/activities-queue.service";
import { ActivityType } from "../../activities/activities-queue/activities-queue.constants";
import { GameAchievementService } from "./game-achievement.service";
import { GameAchievementWithObtainedInfo } from "./dto/game-obtained-achievement.dto";
import { GameObtainedAchievementActivityDto } from "./dto/game-obtained-achievement-activity.dto";
import { toGameAchievementWithObtainedInfo } from "./game-achievement.utils";

@Injectable()
export class GameAchievementActivityService {
    private readonly logger = new Logger(GameAchievementActivityService.name);

    constructor(
        @InjectRepository(ObtainedGameAchievementActivity)
        private readonly obtainedGameAchievementActivityRepository: Repository<ObtainedGameAchievementActivity>,
        private readonly gameAchievementService: GameAchievementService,
        private readonly activitiesQueueService: ActivitiesQueueService,
    ) {}

    public async save(
        activity: Partial<ObtainedGameAchievementActivity>,
        manager?: EntityManager,
    ) {
        const pendingActivity = { ...activity, pendingDelivery: true };
        const persistedEntry = manager
            ? await manager
                  .getRepository(ObtainedGameAchievementActivity)
                  .save(pendingActivity)
            : await playerSyncWrite(() =>
                  this.obtainedGameAchievementActivityRepository.save(
                      pendingActivity,
                  ),
              );

        if (!manager) await this.publish(persistedEntry);

        return persistedEntry;
    }

    public async publish(activity: ObtainedGameAchievementActivity) {
        await this.activitiesQueueService.register(
            {
                sourceId: activity.id,
                profileUserId: activity.profileUserId,
                type: ActivityType.OBTAINED_GAME_ACHIEVEMENT,
            },
            `activity-${ActivityType.OBTAINED_GAME_ACHIEVEMENT}-${activity.id}`,
        );
        await this.obtainedGameAchievementActivityRepository.update(
            activity.id,
            { pendingDelivery: false },
        );
    }

    @Cron("*/5 * * * *")
    async retryPendingDeliveries() {
        const pending = await this.obtainedGameAchievementActivityRepository.find(
            {
                where: { pendingDelivery: true },
                order: { id: "ASC" },
                take: 100,
            },
        );
        for (const activity of pending) {
            try {
                await this.publish(activity);
            } catch {
                this.logger.error(
                    `Could not enqueue achievement activity ${activity.id}; delivery remains pending`,
                );
            }
        }
    }

    public async findOneByIdOrFail(
        id: number,
    ): Promise<GameObtainedAchievementActivityDto> {
        const activity =
            await this.obtainedGameAchievementActivityRepository.findOneOrFail({
                where: { id },
                relations: {
                    externalGame: true,
                    obtainedGameAchievements: true,
                },
            });
        const externalGameId = activity.externalGameId;

        const achievementsForGame =
            await this.gameAchievementService.findAllByExternalGameId(
                externalGameId,
            );

        const achievementDtos: GameAchievementWithObtainedInfo[] = [];

        for (const obtainedAchievement of activity.obtainedGameAchievements) {
            const relatedAchievement = achievementsForGame.find(
                (achievement) =>
                    achievement.externalId ===
                    obtainedAchievement.externalAchievementId,
            );
            if (!relatedAchievement) {
                continue;
            }

            achievementDtos.push(
                toGameAchievementWithObtainedInfo(
                    relatedAchievement,
                    obtainedAchievement,
                ),
            );
        }

        const { pendingDelivery, ...activityData } = activity;
        void pendingDelivery;
        return {
            ...activityData,
            obtainedGameAchievements: achievementDtos,
        };
    }
}
