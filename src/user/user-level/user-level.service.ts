import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { UserLevel } from "./entities/user-level.entity";
import { Repository } from "typeorm";

@Injectable()
export class UserLevelService {
    private readonly currentMaximumLevel = 50;
    private readonly baseLevelUpCostMultiplier = 1.3;

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
        const userLevel = await this.findOneByUserIdOrFail(userId);
        const amountWithMultipler = amount * userLevel.expMultiplier;
        const increasedExp = userLevel.currentLevelExp * amountWithMultipler;
        const levelUpCount = Math.ceil(
            amountWithMultipler / userLevel.nextLevelExp,
        );
        if (levelUpCount >= 1) {
            for (let i = 1; i <= levelUpCount; i++) {
                const updatedCurrentLevel = userLevel.currentLevel + 1;

                await this.userLevelRepository.update(userLevel.id, {
                    currentLevel: updatedCurrentLevel,
                    currentLevelExp: 0,
                    nextLevelExp,
                });
            }

            return;
        }
    }

    private getNextLevelMultipler(
        currentLevel: number,
        currentLevelCost: number,
    ) {
        const maxLevelDerivedMultiplier =
            currentLevel / this.currentMaximumLevel;
        return (
            currentLevelCost *
            (this.baseLevelUpCostMultiplier + maxLevelDerivedMultiplier)
        );
    }
}
