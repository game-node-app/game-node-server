import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { UserLevel } from "./entities/user-level.entity";
import { Repository } from "typeorm";

@Injectable()
export class UserLevelService {
    private readonly currentMaximumLevel = 50;
    /**
     * The base amount to multiply the current level requirement when a user levels up
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
                profile: {
                    userId,
                },
            },
        });
    }

    findOneByUserIdOrFail(userId: string) {
        return this.userLevelRepository.findOneOrFail({
            where: {
                profile: {
                    userId,
                },
            },
        });
    }

    async increaseExp(userId: string, amount: number) {
        let remainingExpAmount = structuredClone(amount);
        while (remainingExpAmount > 0) {
            const userLevelEntity = await this.findOneByUserIdOrFail(userId);
            if (remainingExpAmount <= userLevelEntity.nextLevelExp) {
                await this.userLevelRepository.save({
                    ...userLevelEntity,
                    currentLevelExp:
                        userLevelEntity.currentLevelExp + remainingExpAmount,
                });
                break;
            }
            const updatedUserLevelEntity =
                this.userLevelRepository.create(userLevelEntity);
            const nextLevelExp = this.getNextLevelRequiredExp(
                updatedUserLevelEntity.currentLevel,
                updatedUserLevelEntity.currentLevelExp,
            );
            updatedUserLevelEntity.currentLevel += 1;
            updatedUserLevelEntity.currentLevelExp = 0;
            updatedUserLevelEntity.nextLevelExp = nextLevelExp;
            await this.userLevelRepository.save(updatedUserLevelEntity);
            remainingExpAmount -= userLevelEntity.nextLevelExp;
        }
    }

    private getNextLevelRequiredExp(
        currentLevel: number,
        currentLevelExpCost: number,
    ) {
        const maxLevelCostMultiplier = currentLevel / this.currentMaximumLevel;
        return (
            currentLevelExpCost *
            (this.baseLevelUpCostMultiplier + maxLevelCostMultiplier)
        );
    }
}
