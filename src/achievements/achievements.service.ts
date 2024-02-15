import { HttpException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ObtainedAchievement } from "./entities/obtained-achievement.entity";
import { DataSource, Not, Repository } from "typeorm";
import { achievementsData } from "./data/achievements.data";
import { Achievement } from "./models/achievement.model";
import { TPaginationData } from "../utils/pagination/pagination-response.dto";
import { listToPaginationData } from "../utils/pagination/listToPaginationData";
import { AchievementCategory } from "./achievements.constants";
import { Profile } from "../profile/entities/profile.entity";
import { GetAchievementsRequestDto } from "./dto/get-achievements-request.dto";
import { UpdateFeaturedObtainedAchievementDto } from "./dto/update-featured-obtained-achievement.dto";

function validateAchievements() {
    achievementsData.forEach((achievement, index, array) => {
        const achievementWithInvalidId =
            achievement.id == undefined || typeof achievement.id !== "string";
        if (achievementWithInvalidId) {
            throw new Error(
                `Achievement with duplicated ID found: ${achievement.id} - ${achievement.name}`,
            );
        }
        if (achievement.checkEligibility == undefined) {
            throw new Error(
                `Achievement with id ${achievement.id} has no eligibility check`,
            );
        }
        const achievementWithDuplicateId =
            array.filter(
                (checkedAchievement) =>
                    checkedAchievement.id === achievement.id,
            ).length > 1;
        if (achievementWithDuplicateId) {
            throw new Error(
                `Achievement with duplicated ID found: ${achievement.id} - ${achievement.name}`,
            );
        }
    });
}

@Injectable()
export class AchievementsService {
    constructor(
        @InjectRepository(ObtainedAchievement)
        private obtainedAchievementsRepository: Repository<ObtainedAchievement>,
        private dataSource: DataSource,
    ) {
        validateAchievements();
    }

    /**
     * Validates registered achievements
     * @private
     */

    public getAchievements(
        dto: GetAchievementsRequestDto,
    ): TPaginationData<Achievement> {
        return listToPaginationData(achievementsData, dto?.offset, dto?.limit);
    }

    private checkAchievementsEligibility(
        targetUserId: string,
        achievement: Achievement,
    ): void {
        if (achievement.checkEligibility == undefined) {
            console.warn(`The achievement with id ${achievement.id} 
            can't be processed because it's eligibility function is missing.`);
            return;
        }
        achievement
            .checkEligibility(this.dataSource, targetUserId)
            .then((eligible) => {
                if (eligible) {
                    const obtainedAchivementEntity =
                        this.obtainedAchievementsRepository.create();
                    obtainedAchivementEntity.id = achievement.id;
                    obtainedAchivementEntity.profile = {
                        userId: targetUserId,
                    } as Profile;
                    this.obtainedAchievementsRepository
                        .save(obtainedAchivementEntity)
                        .then()
                        .catch((e) => console.error(e));
                }
            })
            .catch((e) => console.error(e));
    }

    public trackAchievementsProgress(
        targetUserId: string,
        category: AchievementCategory,
    ) {
        const achievementsToProcess = achievementsData.filter(
            (achievement) => achievement.category === category,
        );

        for (const achievement of achievementsToProcess) {
            // Do not await this, as it will block the loop
            this.checkAchievementsEligibility(targetUserId, achievement);
        }
    }

    async getObtainedAchievementById(
        targetUserId: string,
        achievementId: string,
    ) {
        if (!targetUserId) {
            throw new HttpException("", 404);
        }
        const achievement = await this.obtainedAchievementsRepository.findOneBy(
            {
                profile: {
                    userId: targetUserId,
                },
                id: achievementId,
            },
        );

        if (achievement) return achievement;

        throw new HttpException("", 404);
    }

    async updateFeaturedObtainedAchievement(
        userId: string,
        dto: UpdateFeaturedObtainedAchievementDto,
    ) {
        const entity = await this.getObtainedAchievementById(userId, dto.id);
        const updatedEntity = this.obtainedAchievementsRepository.merge(
            entity,
            dto,
        );
        await this.obtainedAchievementsRepository.save(updatedEntity);
        /**
         * Disables isFeatured flag of any other obtained achievement
         */
        if (dto.isFeatured) {
            await this.obtainedAchievementsRepository.update(
                {
                    id: Not(entity.id),
                    profile: {
                        userId,
                    },
                    isFeatured: true,
                },
                {
                    isFeatured: false,
                },
            );
        }
    }
}
