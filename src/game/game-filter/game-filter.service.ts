import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { GameExclusion } from "./entity/game-exclusion.entity";
import { DataSource, In, Repository } from "typeorm";
import { GameRepositoryService } from "../game-repository/game-repository.service";
import { FindAllExcludedGamesRequestDto } from "./dto/find-all-excluded-games.dto";
import { buildBaseFindOptions } from "../../utils/buildBaseFindOptions";
import { TPaginationData } from "../../utils/pagination/pagination-response.dto";
import { ChangeExclusionStatusDto } from "./dto/change-exclusion-status.dto";

import { MATURE_THEME_ID } from "./game-filter.constants";

@Injectable()
export class GameFilterService {
    constructor(
        @InjectRepository(GameExclusion)
        private readonly gameExclusionRepository: Repository<GameExclusion>,
        private readonly gameRepositoryService: GameRepositoryService,
        private readonly dataSource: DataSource,
    ) {}

    public async findAll(
        dto: FindAllExcludedGamesRequestDto,
    ): Promise<TPaginationData<GameExclusion>> {
        const options = buildBaseFindOptions(dto);
        return this.gameExclusionRepository.findAndCount(options);
    }

    public async register(issuerUserId: string, targetGameId: number) {
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

    public async changeStatus(
        targetGameId: number,
        dto: ChangeExclusionStatusDto,
    ) {
        await this.gameRepositoryService.findOneById(targetGameId);
        const exclusion = await this.gameExclusionRepository.findOneByOrFail({
            targetGameId: targetGameId,
        });

        await this.gameExclusionRepository.update(exclusion.id, {
            isActive: dto.isActive,
        });
    }

    public async delete(targetGameId: number) {
        // Errors out if game doesn't exist
        await this.gameRepositoryService.findOneById(targetGameId);

        await this.gameExclusionRepository.delete({
            targetGameId: targetGameId,
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

    public async isMature(targetGameId: number) {
        const game = await this.gameRepositoryService.findOneById(
            targetGameId,
            {
                relations: {
                    themes: true,
                },
            },
        );

        return game.themes!.some((theme) => theme.id === MATURE_THEME_ID);
    }

    /**
     * Returns a list of gameIds with mature games removed.
     * @param gameIds
     */
    public async removeMature(gameIds: number[]) {
        const games = await this.gameRepositoryService.findAllByIds({
            gameIds: gameIds,
            relations: {
                themes: true,
            },
        });

        const matureGameIds = games
            .filter((game) => {
                if (game.themes == undefined) return true;
                return game.themes.some(
                    (theme) => theme.id === MATURE_THEME_ID,
                );
            })
            .map((game) => game.id);

        // Done this way to preserve ordering
        return gameIds.filter((id) => !matureGameIds.includes(id));
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

        // Done this way to preserve ordering
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
