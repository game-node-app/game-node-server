import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { GameExclusion } from "./entity/game-exclusion.entity";
import { DataSource, In, Repository } from "typeorm";
import { GameRepositoryService } from "../game-repository/game-repository.service";

@Injectable()
export class GameFilterService {
    constructor(
        @InjectRepository(GameExclusion)
        private readonly gameExclusionRepository: Repository<GameExclusion>,
        private readonly gameRepositoryService: GameRepositoryService,
        private readonly dataSource: DataSource,
    ) {}

    public async issueExclusion(issuerUserId: string, targetGameId: number) {
        // Errors out if game doesn't exist
        await this.gameRepositoryService.findOneById(targetGameId);

        const existingExclusion = await this.gameExclusionRepository.findOne({
            where: {
                targetGameId: targetGameId,
                isActive: true,
            },
        });

        if (existingExclusion) {
            throw new HttpException(
                "A exclusion for this game is already in place.",
                HttpStatus.BAD_REQUEST,
            );
        }

        await this.gameExclusionRepository.insert({
            targetGameId: targetGameId,
            isActive: true,
            issuerUserId: issuerUserId,
        });
    }

    public async isExcluded(targetGameId: number) {
        return await this.gameExclusionRepository.exists({
            where: {
                targetGameId: targetGameId,
                isActive: true,
            },
        });
    }

    /**
     * Returns a list of gameIds with excluded ones removed.
     * @param gameIds
     */
    public async removeExcluded(gameIds: number[]) {
        const excludedIds = await this.gameExclusionRepository.findBy({
            targetGameId: In(gameIds),
            isActive: true,
        });

        return gameIds.filter((gameId) => {
            return !excludedIds.some(
                (excluded) => excluded.targetGameId === gameId,
            );
        });
    }

    /**
     * Returns a subquery to be used with QueryBuilders that automatically removes excluded
     * games. <br>
     * This subquery should run with a 'NOT EXISTS' statement.
     * @param targetGameIdRelation - Target entity alias followed by target game id property
     * e.g. 'ge.gameId'
     * @see https://www.w3schools.com/mysql/mysql_exists.asp
     */
    public buildQueryBuilderSubQuery(targetGameIdRelation: string) {
        return this.dataSource
            .createQueryBuilder()
            .subQuery()
            .from(GameExclusion, "ge")
            .select("1")
            .where(`ge.targetGameId = ${targetGameIdRelation}`)
            .andWhere(`ge.isActive = true`)
            .getQuery();
    }
}
