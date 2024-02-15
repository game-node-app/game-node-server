import { HttpException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { UserLevel } from "./entities/user-level.entity";
import { Repository } from "typeorm";
import { BASE_LEVEL_UP_COST } from "./user-level.constants";

@Injectable()
export class UserLevelService {
    private readonly currentMaximumLevel = 50;
    /**
     * The base amount to multiply the current user-level requirement when a user levels up
     * @private
     */
    private readonly baseLevelUpCostMultiplier = 1.5;

    constructor(
        @InjectRepository(UserLevel)
        private readonly userLevelRepository: Repository<UserLevel>,
    ) {}

    findOneByUserId(userId: string) {
        return this.userLevelRepository.findOne({
            where: {
                userId,
            },
        });
    }

    async findOneByUserIdOrFail(userId: string) {
        const entity = await this.findOneByUserId(userId);
        if (!entity) throw new HttpException("", 404);
        return entity;
    }

    async create(userId: string) {
        await this.userLevelRepository.save({
            userId,
            profile: {
                userId,
            },
        });
    }

    async increaseExp(userId: string, amount: number) {
        const userLevelEntity = await this.findOneByUserIdOrFail(userId);
        const multipliedExpAmount = amount * userLevelEntity.expMultiplier;
        let unprocessedExpAmount = structuredClone(multipliedExpAmount);
        const updatedUserLevelEntity =
            this.userLevelRepository.create(userLevelEntity);

        while (unprocessedExpAmount > 0) {
            const nextLevel = updatedUserLevelEntity.currentLevel + 1;
            const nextLevelRequiredExp = this.getLevelUpExpCost(nextLevel);
            const currentLevelRequiredExp = structuredClone(
                updatedUserLevelEntity.levelUpExpCost,
            );

            if (unprocessedExpAmount > updatedUserLevelEntity.levelUpExpCost) {
                updatedUserLevelEntity.currentLevel = nextLevel;
                updatedUserLevelEntity.currentLevelExp = 0;
                updatedUserLevelEntity.levelUpExpCost = nextLevelRequiredExp;
            } else {
                updatedUserLevelEntity.currentLevelExp += unprocessedExpAmount;
            }

            unprocessedExpAmount -= currentLevelRequiredExp;
        }

        await this.userLevelRepository.save(updatedUserLevelEntity);
    }

    /**
     * Retrieves the levelUpExpCost to reach a new user-level based on the provided user-level.
     * @param level
     * @private
     */
    private getLevelUpExpCost(level: number) {
        const maxLevelCostMultiplier = level / this.currentMaximumLevel;
        const baseCurrentLevelCost = level * BASE_LEVEL_UP_COST;
        return (
            baseCurrentLevelCost *
            (this.baseLevelUpCostMultiplier + maxLevelCostMultiplier)
        );
    }
}
