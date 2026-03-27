import { InjectRepository } from "@nestjs/typeorm";
import { ObtainedGameAchievementActivity } from "./entity/obtained-game-achievement-activity.entity";
import { Repository } from "typeorm";
import { Injectable } from "@nestjs/common";
import { ActivitiesQueueService } from "../../activities/activities-queue/activities-queue.service";
import { ActivityType } from "../../activities/activities-queue/activities-queue.constants";
import { GameAchievementService } from "./game-achievement.service";
import { GameAchievementWithObtainedInfo } from "./dto/game-obtained-achievement.dto";
import { GameObtainedAchievementActivityDto } from "./dto/game-obtained-achievement-activity.dto";
import { toGameAchievementWithObtainedInfo } from "./game-achievement.utils";

@Injectable()
export class GameAchievementActivityService {
    constructor(
        @InjectRepository(ObtainedGameAchievementActivity)
        private readonly obtainedGameAchievementActivityRepository: Repository<ObtainedGameAchievementActivity>,
        private readonly gameAchievementService: GameAchievementService,
        private readonly activitiesQueueService: ActivitiesQueueService,
    ) {}

    public async save(activity: Partial<ObtainedGameAchievementActivity>) {
        const persistedEntry =
            await this.obtainedGameAchievementActivityRepository.save(activity);

        this.activitiesQueueService.register({
            sourceId: persistedEntry.id,
            profileUserId: persistedEntry.profileUserId,
            type: ActivityType.OBTAINED_GAME_ACHIEVEMENT,
        });

        return persistedEntry;
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

        return {
            ...activity,
            obtainedGameAchievements: achievementDtos,
        };
    }
}
