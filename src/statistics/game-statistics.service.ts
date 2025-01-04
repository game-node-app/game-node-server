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
import { MATURE_THEME_ID } from "../game/game-filter/game-filter.constants";
import isEmptyObject from "../utils/isEmptyObject";

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
        data: FindStatisticsTrendingGamesDto,
    ): Promise<TPaginationData<GameStatistics>> {
        const { period, criteria, offset, limit } = data;
        const offsetToUse = offset || 0;
        // We save up to this N statistics entities on cache to improve load performance.
        const fixedStatisticsLimit = 25000;
        // User supplied limit
        const limitToUse = limit || 20;
        const minusDays = StatisticsPeriodToMinusDays[period];
        const viewsStartDate = getPreviousDate(minusDays);

        let statistics = await this.getCachedStatistics(period);

        if (statistics == undefined) {
            const queryBuilder =
                this.gameStatisticsRepository.createQueryBuilder("s");

            /**
             * Made with query builder, so we can further optimize the query
             */
            const query = queryBuilder
                .select()
                .leftJoin(UserView, `uv`, `uv.gameStatisticsId = s.id`)
                .where(`(uv.createdAt >= :uvDate OR s.viewsCount = 0)`, {
                    uvDate: viewsStartDate,
                })
                // Excludes games with mature theme
                .andWhere(
                    `NOT EXISTS (SELECT 1 FROM game_themes_game_theme AS gtgt WHERE gtgt.gameId = s.gameId 
                AND gtgt.gameThemeId = :excludedThemeId)`,
                    {
                        excludedThemeId: MATURE_THEME_ID,
                    },
                )
                .addOrderBy(`s.viewsCount`, `DESC`)
                .skip(0)
                .take(fixedStatisticsLimit);

            statistics = await query.getMany();
            this.setCachedStatistics(period, statistics);
        }

        // This greatly improves performance when no filtering is actually being done.
        if (criteria == undefined || isEmptyObject(criteria)) {
            const slicedStatistics = statistics.slice(
                offsetToUse,
                offsetToUse + limitToUse,
            );
            return [slicedStatistics, fixedStatisticsLimit];
        }

        const gameIds = statistics.map((s) => s.gameId);
        const games = await this.gameRepositoryService.findAllIdsWithFilters({
            ...criteria,
            ids: gameIds,
            // We need to return all entities to maintain pagination order
            limit: fixedStatisticsLimit,
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
