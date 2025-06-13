import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { GameStatistics } from "./entity/game-statistics.entity";
import { Repository } from "typeorm";
import { ReviewStatistics } from "./entity/review-statistics.entity";
import { Cacheable } from "../utils/cacheable";
import { hours } from "@nestjs/throttler";
import { FindStatisticsTrendingReviewsDto } from "./dto/find-statistics-trending-reviews.dto";
import { TPaginationData } from "../utils/pagination/pagination-response.dto";
import { buildBaseFindOptions } from "../utils/buildBaseFindOptions";
import {
    StatisticsPeriod,
    StatisticsPeriodToMinusDays,
    StatisticsSourceType,
} from "./statistics.constants";
import { getPreviousDate } from "./statistics.utils";
import { Review } from "../reviews/entities/review.entity";
import { UserLike } from "./entity/user-like.entity";
import { UserView } from "./entity/user-view.entity";
import { Cache } from "@nestjs/cache-manager";
import { FindStatisticsTrendingGamesDto } from "./dto/find-statistics-trending-games.dto";
import { MATURE_THEME_ID } from "../game/game-filter/game-filter.constants";
import isEmptyObject from "../utils/isEmptyObject";
import { GameRepositoryService } from "../game/game-repository/game-repository.service";

@Injectable()
export class StatisticsTrendingService {
    private readonly logger = new Logger(StatisticsTrendingService.name);

    constructor(
        private readonly cacheManager: Cache,
        @InjectRepository(GameStatistics)
        private readonly gameStatisticsRepository: Repository<GameStatistics>,
        @InjectRepository(ReviewStatistics)
        private readonly reviewStatisticsRepository: Repository<ReviewStatistics>,
        @InjectRepository(UserLike)
        private readonly userLikeRepository: Repository<UserLike>,
        @InjectRepository(UserView)
        private readonly userViewRepository: Repository<UserView>,
        private readonly gameRepositoryService: GameRepositoryService,
    ) {}

    private async getCachedStatistics(
        sourceType: StatisticsSourceType,
        period: StatisticsPeriod,
    ) {
        const cachedStatistics = await this.cacheManager.get<GameStatistics[]>(
            `trending-${sourceType}-statistics-${period}`,
        );
        if (cachedStatistics != undefined && !Array.isArray(cachedStatistics)) {
            return undefined;
        }

        return cachedStatistics;
    }

    private setCachedStatistics(
        sourceType: StatisticsSourceType,
        period: StatisticsPeriod,
        data: GameStatistics[],
    ) {
        this.cacheManager
            .set(`trending-${sourceType}-statistics-${period}`, data, hours(24))
            .then()
            .catch((err) => {
                this.logger.error(err);
            });
    }

    /**
     * Finds trending reviews, giving preference to a specific review (if provided) by boosting it to the top.
     * @param dto
     */
    @Cacheable(StatisticsTrendingService.name, hours(1))
    public async findTrendingReviews(
        dto: FindStatisticsTrendingReviewsDto,
    ): Promise<TPaginationData<ReviewStatistics>> {
        const baseFindOptions = buildBaseFindOptions<ReviewStatistics>(dto);

        const periodMinusDays = StatisticsPeriodToMinusDays[dto.period];
        const periodStartDate = getPreviousDate(periodMinusDays);

        const likesInPeriodSubQuery = this.userLikeRepository
            .createQueryBuilder("ul")
            .select("ul.reviewStatisticsId, COUNT(ul.id) as total")
            .where("ul.reviewStatisticsId IS NOT NULL")
            .groupBy("ul.reviewStatisticsId");

        // Improves performance by only querying with createdAt date
        // when necessary
        if (dto.period !== StatisticsPeriod.ALL) {
            likesInPeriodSubQuery.andWhere("ul.createdAt >= :periodStartDate");
        }

        const statisticsQuery = this.reviewStatisticsRepository
            .createQueryBuilder("rs")
            .addSelect("IFNULL(in_period.total, 0) AS likes_in_period")
            .leftJoin(
                `(${likesInPeriodSubQuery.getQuery()})`,
                "in_period",
                "in_period.reviewStatisticsId = rs.id",
            )
            .innerJoinAndSelect(Review, "r", "r.id = rs.reviewId")
            .take(baseFindOptions.take)
            .skip(baseFindOptions.skip);

        if (dto.userId) {
            statisticsQuery.andWhere("r.profileUserId = :userId");
        }
        if (dto.gameId) {
            statisticsQuery.andWhere("r.gameId = :gameId");
        }

        // Build the ordering:
        // If a reviewId is provided, use a CASE expression to bring that review to the top.
        if (dto.reviewId) {
            statisticsQuery
                .orderBy(`CASE WHEN r.id = :reviewId THEN 0 ELSE 1 END`, "ASC")
                .addOrderBy("likes_in_period", "DESC")
                .addOrderBy("r.createdAt", "DESC");
        } else {
            statisticsQuery
                .orderBy("likes_in_period", "DESC")
                .addOrderBy("r.createdAt", "DESC");
        }

        // Sets all parameters for query and subqueries
        statisticsQuery.setParameters({
            periodStartDate: periodStartDate,
            userId: dto.userId,
            gameId: dto.gameId,
            reviewId: dto.reviewId,
        });

        return await statisticsQuery.getManyAndCount();
    }

    async findTrendingGames(
        dto: FindStatisticsTrendingGamesDto,
    ): Promise<TPaginationData<GameStatistics>> {
        const { period, criteria, offset, limit } = dto;
        const offsetToUse = offset || 0;

        const FIXED_STATISTICS_LIMIT = 50000;
        // User supplied limit
        const limitToUse = limit || 20;
        const minusDays = StatisticsPeriodToMinusDays[period];
        const viewsStartDate = getPreviousDate(minusDays);

        let statistics = await this.getCachedStatistics(
            StatisticsSourceType.GAME,
            period,
        );

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
            this.setCachedStatistics(
                StatisticsSourceType.GAME,
                period,
                statistics,
            );
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
}
