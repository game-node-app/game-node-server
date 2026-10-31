import { HttpException, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { UserLevel } from "./entities/user-level.entity";
import { EntityManager, Repository } from "typeorm";
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
    async findOneOrCreateByUserId(
        userId: string,
        repository = this.userLevelRepository,
    ): Promise<UserLevel> {
        const entity = await repository.findOne({
            where: {
                userId,
            },
            // Serializes concurrent exp grants when called inside a transaction
            lock: repository.queryRunner?.isTransactionActive
                ? { mode: "pessimistic_write" }
                : undefined,
        });

        if (entity == undefined) {
            return this.create(userId, repository);
        }

        return entity;
    }

    async findOneByUserIdOrFail(userId: string) {
        const entity = await this.findOneOrCreateByUserId(userId);
        if (!entity) throw new HttpException("Not available.", 404);
        return entity;
    }

    async create(userId: string, repository = this.userLevelRepository) {
        return await repository.save({
            userId,
            profile: {
                userId,
            },
        });
    }

    /**
     * @param manager - when given, exp is persisted in its transaction
     */
    async increaseExp(userId: string, amount: number, manager?: EntityManager) {
        const repository =
            manager?.getRepository(UserLevel) ?? this.userLevelRepository;
        const userLevelEntity = await this.findOneOrCreateByUserId(
            userId,
            repository,
        );
        const multipliedExpAmount = amount * userLevelEntity.expMultiplier;
        let unprocessedExpAmount = structuredClone(multipliedExpAmount);
        const updatedUserLevelEntity = repository.create(userLevelEntity);

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

        await repository.save(updatedUserLevelEntity);
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
