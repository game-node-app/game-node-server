import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { GameStatistics } from "./entity/game-statistics.entity";
import { Repository } from "typeorm";
import { UserLike } from "./entity/user-like.entity";
import { UserView } from "./entity/user-view.entity";
import {
    StatisticsCreateAction,
    StatisticsLikeAction,
    StatisticsViewAction,
} from "./statistics-queue/statistics-queue.types";
import {
    StatisticsActionType,
    StatisticsPeriod,
    StatisticsPeriodToMinusDays,
    StatisticsSourceType,
} from "./statistics.constants";
import { StatisticsService } from "./statistics.types";
import { TPaginationData } from "../utils/pagination/pagination-response.dto";
import { StatisticsStatus } from "./dto/statistics-entity.dto";
import { FindStatisticsTrendingGamesDto } from "./dto/find-statistics-trending-games.dto";
import { getPreviousDate } from "./statistics.utils";
import { hours } from "@nestjs/throttler";
import { GameRepositoryService } from "../game/game-repository/game-repository.service";
import { Cache } from "@nestjs/cache-manager";
import isEmptyObject from "../utils/isEmptyObject";
import { MATURE_THEME_ID } from "../game/game-filter/game-filter.constants";

@Injectable()
export class GameStatisticsService implements StatisticsService {
    private logger = new Logger(GameStatisticsService.name);

    constructor(
        @InjectRepository(GameStatistics)
        private readonly gameStatisticsRepository: Repository<GameStatistics>,
        @InjectRepository(UserLike)
        private readonly userLikeRepository: Repository<UserLike>,
        @InjectRepository(UserView)
        private readonly userViewRepository: Repository<UserView>,
        private readonly gameRepositoryService: GameRepositoryService,
        private readonly cacheManager: Cache,
    ) {}

    private async getCachedStatistics(period: StatisticsPeriod) {
        const cachedStatistics = await this.cacheManager.get<GameStatistics[]>(
            `trending-games-statistics-${period}`,
        );
        if (cachedStatistics != undefined && !Array.isArray(cachedStatistics)) {
            return undefined;
        }

        return cachedStatistics;
    }

    private setCachedStatistics(
        period: StatisticsPeriod,
        data: GameStatistics[],
    ) {
        this.cacheManager
            .set(`trending-games-statistics-${period}`, data, hours(24))
            .then()
            .catch((err) => {
                this.logger.error(err);
            });
    }

    /**
     * Creates a new GameStatistics. <br>
     * Returns previous one if it already exists.
     * @param data
     */
    public async create(data: StatisticsCreateAction) {
        const gameId = data.sourceId as number;
        const existingEntity = await this.findOne(gameId);

        if (existingEntity) return existingEntity;

        return await this.gameStatisticsRepository.save({
            gameId,
        });
    }

    public async findOne(gameId: number) {
        return await this.gameStatisticsRepository.findOneBy({
            gameId,
        });
    }

    public async handleLike(data: StatisticsLikeAction) {
        const { sourceId, userId, action } = data;
        if (typeof sourceId !== "number") {
            throw new Error("Invalid type for game-statistics like");
        }

        const entry = await this.create({
            sourceId,
            sourceType: StatisticsSourceType.GAME,
        });

        const isLiked = await this.userLikeRepository.existsBy({
            profileUserId: userId,
            gameStatistics: entry,
        });

        const invalidIncrement =
            action === StatisticsActionType.INCREMENT && isLiked;
        const invalidDecrement =
            action === StatisticsActionType.DECREMENT && !isLiked;

        if (invalidIncrement || invalidDecrement) {
            return;
        }

        if (action === StatisticsActionType.DECREMENT) {
            await this.userLikeRepository.delete({
                profile: {
                    userId,
                },
                gameStatistics: entry,
            });

            if (entry.likesCount > 0) {
                await this.gameStatisticsRepository.decrement(
                    {
                        id: entry.id,
                    },
                    "likesCount",
                    1,
                );
            }

            return;
        }

        // This will fail if the user doesn't have a profile.
        await this.userLikeRepository.save({
            profile: {
                userId,
            },
            gameStatistics: entry,
        });

        await this.gameStatisticsRepository.increment(
            {
                id: entry.id,
            },
            "likesCount",
            1,
        );
    }

    public async handleView(data: StatisticsViewAction) {
        const { userId, sourceId } = data;
        let idToUse: number;
        if (typeof sourceId !== "number") {
            idToUse = parseInt(sourceId, 10);
        } else {
            idToUse = sourceId;
        }

        const entry = await this.create({
            sourceId: idToUse,
            sourceType: StatisticsSourceType.GAME,
        });

        await this.userViewRepository.save({
            profile: {
                userId: userId,
            },
            gameStatistics: entry,
        });

        await this.gameStatisticsRepository.increment(
            {
                gameId: idToUse,
            },
            "viewsCount",
            1,
        );
    }

    async findTrending(
        dto: FindStatisticsTrendingGamesDto,
    ): Promise<TPaginationData<GameStatistics>> {
        const { period, criteria, offset, limit } = dto;
        const offsetToUse = offset || 0;

        const FIXED_STATISTICS_LIMIT = 50000;
        // User supplied limit
        const limitToUse = limit || 20;
        const minusDays = StatisticsPeriodToMinusDays[period];
        const viewsStartDate = getPreviousDate(minusDays);

        let statistics = await this.getCachedStatistics(period);

        if (statistics == undefined) {
            /**
             * Made with query builder, so we can further optimize the query
             */
            const queryBuilder =
                this.gameStatisticsRepository.createQueryBuilder("gs");

            const userViewSubQuery = this.userViewRepository
                .createQueryBuilder("uv")
                .select("uv.gameStatisticsId, COUNT(uv.id) AS total")
                .where("uv.gameStatisticsId IS NOT NULL")
                .groupBy("uv.gameStatisticsId");

            if (period !== StatisticsPeriod.ALL) {
                userViewSubQuery.andWhere("uv.createdAt >= :viewsStartDate");
            }

            const query = queryBuilder
                .addSelect("IFNULL(in_period.total, 0) AS views_in_period")
                .leftJoin(
                    `(${userViewSubQuery.getQuery()})`,
                    "in_period",
                    "in_period.gameStatisticsId = gs.id",
                )
                .where(
                    // Excludes games with mature theme
                    `NOT EXISTS (SELECT 1 FROM game_themes_game_theme AS gtgt WHERE gtgt.gameId = gs.gameId
                AND gtgt.gameThemeId = :excludedThemeId)`,
                )
                .orderBy("views_in_period", "DESC")
                .addOrderBy("gs.viewsCount", "DESC")
                .limit(FIXED_STATISTICS_LIMIT);

            query.setParameters({
                viewsStartDate: viewsStartDate,
                excludedThemeId: MATURE_THEME_ID,
            });

            statistics = await query.getMany();
            // Storing the entire table takes roughly ~16mb in Redis.
            // 16mb * 7 = ~112mb to store statistics for all periods
            this.setCachedStatistics(period, statistics);
        }

        // This greatly improves performance when no filtering is actually being done.
        if (criteria == undefined || isEmptyObject(criteria)) {
            const slicedStatistics = statistics.slice(
                offsetToUse,
                offsetToUse + limitToUse,
            );
            return [slicedStatistics, FIXED_STATISTICS_LIMIT];
        }

        const gameIds = statistics.map((s) => s.gameId);
        const games = await this.gameRepositoryService.findAllIdsWithFilters({
            ...criteria,
            ids: gameIds,
            // We need to return all entities to maintain pagination order
            limit: FIXED_STATISTICS_LIMIT,
            offset: 0,
        });
        const totalAvailableGames = games.length;
        const gamesSlice = games
            .slice(offsetToUse, offsetToUse + limitToUse)
            .map((game) => game.id);
        const relevantStatistics = statistics.filter((statistics) =>
            gamesSlice.includes(statistics.gameId),
        );
        return [relevantStatistics, totalAvailableGames];
    }

    public async getStatus(
        statisticsId: number,
        userId: string | undefined,
    ): Promise<StatisticsStatus> {
        if (userId) {
            const isLikedQuery = this.userLikeRepository.exists({
                where: {
                    gameStatistics: {
                        id: statisticsId,
                    },
                    profile: {
                        userId,
                    },
                },
            });
            const isViewedQuery = this.userViewRepository.exists({
                where: {
                    gameStatistics: {
                        id: statisticsId,
                    },
                    profile: {
                        userId,
                    },
                },
            });
            const [isLiked, isViewed] = await Promise.all([
                isLikedQuery,
                isViewedQuery,
            ]);

            return {
                isLiked,
                isViewed,
            };
        }

        return {
            isLiked: false,
            isViewed: false,
        };
    }
}
