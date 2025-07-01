import { HttpException, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { UserLevel } from "./entities/user-level.entity";
import { Repository } from "typeorm";
import {
    BASE_LEVEL_UP_COST,
    LevelActivitiesToIncreaseAmountMap,
    LevelIncreaseActivities,
} from "./level.constants";

@Injectable()
export class LevelService {
    private readonly logger = new Logger(LevelService.name);
    private readonly currentMaximumLevel = 50;
    /**
     * The base amount to multiply the current user-level requirement when a user levels up
     * @private
     */
    private readonly baseLevelUpCostMultiplier = 1.2;

    constructor(
        @InjectRepository(UserLevel)
        private readonly userLevelRepository: Repository<UserLevel>,
    ) {}

    /**
     * Important: do not expose this.
     * @param userId
     */
    async findOneOrCreateByUserId(userId: string): Promise<UserLevel> {
        const entity = await this.userLevelRepository.findOne({
            where: {
                userId,
            },
        });

        if (entity == undefined) {
            return this.create(userId);
        }

        return entity;
    }

    async findOneByUserIdOrFail(userId: string) {
        const entity = await this.findOneOrCreateByUserId(userId);
        if (!entity) throw new HttpException("Not available.", 404);
        return entity;
    }

    async create(userId: string) {
        return await this.userLevelRepository.save({
            userId,
            profile: {
                userId,
            },
        });
    }

    async increaseExp(userId: string, amount: number) {
        const userLevelEntity = await this.findOneOrCreateByUserId(userId);
        const multipliedExpAmount = amount * userLevelEntity.expMultiplier;
        let unprocessedExpAmount = structuredClone(multipliedExpAmount);
        const updatedUserLevelEntity =
            this.userLevelRepository.create(userLevelEntity);

        while (unprocessedExpAmount > 0) {
            const totalCurrentLevelExp =
                updatedUserLevelEntity.currentLevelExp + unprocessedExpAmount;
            const nextLevel = updatedUserLevelEntity.currentLevel + 1;
            const nextLevelRequiredExp = this.getLevelUpExpCost(nextLevel);
            /**
             * Alas: exp processed in this iteration
             */
            const currentLevelRequiredExp = structuredClone(
                updatedUserLevelEntity.levelUpExpCost,
            );

            if (totalCurrentLevelExp >= updatedUserLevelEntity.levelUpExpCost) {
                let remainingExp = 0;
                if (totalCurrentLevelExp - currentLevelRequiredExp > 0) {
                    remainingExp =
                        totalCurrentLevelExp - currentLevelRequiredExp;
                }
                updatedUserLevelEntity.currentLevel = nextLevel;
                updatedUserLevelEntity.currentLevelExp = remainingExp;
                updatedUserLevelEntity.levelUpExpCost = nextLevelRequiredExp;
            } else {
                updatedUserLevelEntity.currentLevelExp += unprocessedExpAmount;
            }

            unprocessedExpAmount -= currentLevelRequiredExp;
        }

        await this.userLevelRepository.save(updatedUserLevelEntity);
    }

    registerLevelExpIncreaseActivity(
        userId: string,
        activity: LevelIncreaseActivities,
    ) {
        const activityIncreaseAmount =
            LevelActivitiesToIncreaseAmountMap[activity];
        if (activityIncreaseAmount == undefined) {
            throw new Error(
                `Invalid activity when registering level increase: '${activity}' not valid.`,
            );
        }

        this.increaseExp(userId, activityIncreaseAmount)
            .then()
            .catch((err) => {
                this.logger.error(err);
            });
    }

    /**
     * Retrieves the levelUpExpCost to reach a new level based on the provided level.
     * @param level
     * @private
     */
    private getLevelUpExpCost(level: number) {
        const maxLevelCostMultiplier = level / this.currentMaximumLevel - 0.5;
        const baseCurrentLevelCost = level * BASE_LEVEL_UP_COST;
        return (
            baseCurrentLevelCost *
            (this.baseLevelUpCostMultiplier + maxLevelCostMultiplier)
        );
    }
}
