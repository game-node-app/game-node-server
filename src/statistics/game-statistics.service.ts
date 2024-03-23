import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { GameStatistics } from "./entity/game-statistics.entity";
import { Repository } from "typeorm";
import { UserLike } from "./entity/user-like.entity";
import { UserView } from "./entity/user-view.entity";
import {
    StatisticsLikeAction,
    StatisticsViewAction,
} from "./statistics-queue/statistics-queue.types";
import {
    StatisticsActionType,
    StatisticsPeriodToMinusDays,
} from "./statistics.constants";
import { StatisticsService } from "./statistics.types";
import { TPaginationData } from "../utils/pagination/pagination-response.dto";
import { StatisticsStatus } from "./dto/statistics-entity.dto";
import { FindStatisticsTrendingGamesDto } from "./dto/find-statistics-trending-games.dto";
import { getPreviousDate } from "./statistics.utils";
import { days, hours } from "@nestjs/throttler";
import { GameRepositoryService } from "../game/game-repository/game-repository.service";
import { Interval } from "@nestjs/schedule";

@Injectable()
export class GameStatisticsService implements StatisticsService {
    constructor(
        @InjectRepository(GameStatistics)
        private readonly gameStatisticsRepository: Repository<GameStatistics>,
        @InjectRepository(UserLike)
        private readonly userLikeRepository: Repository<UserLike>,
        @InjectRepository(UserView)
        private readonly userViewRepository: Repository<UserView>,
        private readonly gameRepositoryService: GameRepositoryService,
    ) {}

    /**
     * Creates a new GameStatistics. <br>
     * Returns previous one if it already exists.
     * @param gameId
     */
    public async create(gameId: number) {
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

        const entry = await this.create(sourceId);

        const isLiked = await this.userLikeRepository.existsBy({
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

        const entry = await this.create(idToUse);

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

    @Interval(hours(6))
    async preCacheTrendingGames() {
        // Call logic here, forcing a cache to be populated again.
    }

    async findTrending(
        data: FindStatisticsTrendingGamesDto,
    ): Promise<TPaginationData<GameStatistics>> {
        const { period, criteria, offset, limit } = data;
        const offsetToUse = offset || 0;
        const limitToUse = limit || 20;
        const minusDays = StatisticsPeriodToMinusDays[period];
        const periodDate = getPreviousDate(minusDays);

        console.time("game-trending-statistics");
        const queryBuilder =
            this.gameStatisticsRepository.createQueryBuilder("s");

        /**
         * Made with query builder, so we can further optimize the query
         */
        const statistics = await queryBuilder
            .select()
            .leftJoin(UserView, `uv`, `uv.gameStatisticsId = s.id`)
            .where(`uv.createdAt >= :uvDate`, {
                uvDate: periodDate,
            })
            .orWhere(`(s.viewsCount = 0 AND s.likesCount = 0)`)
            .addOrderBy(`s.viewsCount`, `DESC`)
            .skip(0)
            .take(1000)
            .cache(days(1))
            .getMany();

        console.timeEnd("game-trending-statistics");

        console.time("game-trending-filter");
        const gameIds = statistics.map((s) => s.gameId);
        const games = await this.gameRepositoryService.findAllIdsWithFilters({
            ...criteria,
            id: gameIds,
            // We need to return all entities to maintain pagination order
            limit: 1000,
            offset: 0,
        });
        const totalAvailableGames = games.length;
        const gamesSlice = games.slice(offsetToUse, offsetToUse + limitToUse);
        const relevantStatistics = statistics.filter((statistics) =>
            gamesSlice.includes(statistics.gameId),
        );
        console.timeEnd("game-trending-filter");
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
