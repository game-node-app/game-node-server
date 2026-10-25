import { playerSyncWrite } from "../../sync/player-sync-attempt";
import { Injectable, Logger } from "@nestjs/common";
import {
    Between,
    FindOptionsRelations,
    FindOptionsWhere,
    EntityManager,
    Repository,
} from "typeorm";
import { GameCompletionStatus } from "./entity/game-completion-status.entity";
import { InjectRepository } from "@nestjs/typeorm";
import {
    checkIfGameIsComplete,
    checkIfGameIsPlatinum,
} from "./game-achievement.utils";
import { generateChecksum } from "../../utils/checksum";
import { FindGameCompletionStatusDto } from "./dto/game-completion-status.dto";
import { GameAchievementDto } from "./dto/game-achievement.dto";
import { GameObtainedAchievementDto } from "./dto/game-obtained-achievement.dto";

const createChecksum = (status: GameCompletionStatus) => {
    const comparableEntity: Partial<GameCompletionStatus> = {
        externalGameId: status.externalGameId,
        profileUserId: status.profileUserId,
        isCompleted: status.isCompleted,
        isPlatinumObtained: status.isPlatinumObtained,
        totalAvailableAchievements: status.totalAvailableAchievements,
        totalObtainedAchievements: status.totalObtainedAchievements,
    };

    return generateChecksum(comparableEntity);
};

@Injectable()
export class GameAchievementStatusService {
    private readonly logger = new Logger(GameAchievementStatusService.name);
    private readonly relations: FindOptionsRelations<GameCompletionStatus> = {
        externalGame: true,
    };

    constructor(
        @InjectRepository(GameCompletionStatus)
        private readonly gameCompletionStatusRepository: Repository<GameCompletionStatus>,
    ) {}

    async findStatusByUserIdOrFail(userId: string, externalGameId: number) {
        return this.gameCompletionStatusRepository.findOneOrFail({
            where: {
                profileUserId: userId,
                externalGameId,
            },
            relations: this.relations,
        });
    }

    async findAllStatusByUserId(
        userId: string,
        dto: FindGameCompletionStatusDto,
    ) {
        const { onlyCompleted, completedPeriodStart, completedPeriodEnd } = dto;

        const filterOptions: FindOptionsWhere<GameCompletionStatus> = {
            completedAt:
                completedPeriodStart && completedPeriodEnd
                    ? Between(completedPeriodStart, completedPeriodEnd)
                    : undefined,
            isCompleted: onlyCompleted ? true : undefined,
        };

        return this.gameCompletionStatusRepository.find({
            where: {
                profileUserId: userId,
                ...filterOptions,
            },
            order: {
                completedAt: "DESC",
                updatedAt: "DESC",
            },
            relations: this.relations,
        });
    }

    async updateGameCompletionStatus(
        userId: string,
        externalGameId: number,
        gameAchievements: GameAchievementDto[],
        obtainedAchievements: GameObtainedAchievementDto[],
        manager?: EntityManager,
    ) {
        const repository =
            manager?.getRepository(GameCompletionStatus) ??
            this.gameCompletionStatusRepository;
        if (gameAchievements.length === 0) {
            return;
        }

        const actuallyObtainedAchievements = obtainedAchievements.filter(
            (obtained) => obtained.isObtained && obtained.obtainedAt != null,
        );

        const isCompleted = checkIfGameIsComplete(
            gameAchievements,
            actuallyObtainedAchievements,
        );

        const isPlatinum = checkIfGameIsPlatinum(
            gameAchievements,
            actuallyObtainedAchievements,
        );

        const existingEntity = await repository.findOneBy({
            externalGameId,
            profileUserId: userId,
        });

        const entity = repository.create({
            externalGameId,
            profileUserId: userId,
            isCompleted,
            isPlatinumObtained: isPlatinum,
            totalAvailableAchievements: gameAchievements.length,
            totalObtainedAchievements: actuallyObtainedAchievements.length,
            completedAt: isCompleted
                ? existingEntity?.isCompleted && existingEntity.completedAt
                    ? existingEntity.completedAt
                    : new Date()
                : null,
        });

        const checksum = createChecksum(entity);

        const checksumMatches =
            existingEntity != undefined && existingEntity.checksum === checksum;

        if (checksumMatches) {
            this.logger.log(
                `No changes detected for game completion status of user ${userId} and game ${externalGameId}. Skipping update.`,
            );
            return;
        }

        const save = () =>
            repository.save({
                ...entity,
                checksum,
            });
        if (manager) await save();
        else await playerSyncWrite(save);

        this.logger.log(
            `Updated game completion status for user ${userId} and game ${externalGameId}. Completed: ${isCompleted}, Platinum: ${isPlatinum}, Total Achievements: ${gameAchievements.length}, Obtained Achievements: ${obtainedAchievements.length}`,
        );
    }
}
