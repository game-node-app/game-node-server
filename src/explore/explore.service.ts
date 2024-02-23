import { Injectable } from "@nestjs/common";
import { GameRepositoryFilterDto } from "../game/game-repository/dto/game-repository-filter.dto";
import { GameRepositoryService } from "../game/game-repository/game-repository.service";
import { StatisticsService } from "../statistics/statistics.service";
import { StatisticsPeriod } from "../statistics/statistics.constants";
import { TPaginationData } from "../utils/pagination/pagination-response.dto";
import { Game } from "../game/game-repository/entities/game.entity";

const FIXED_SORTED_GAMES_LIMIT = 500;

@Injectable()
export class ExploreService {
    constructor(
        private gameService: GameRepositoryService,
        private statisticsService: StatisticsService,
    ) {}

    async findSortedGames(
        dto: GameRepositoryFilterDto,
    ): Promise<TPaginationData<Game>> {
        const filteredGames = await this.gameService.findAllWithFilter({
            ...dto,
            limit: FIXED_SORTED_GAMES_LIMIT,
        });
        const games = filteredGames[0];
        if (games.length === 0) {
            return [[], 0];
        }
        const gamesIds = games.map((game) => game.id);
        const filteredGamesStatistics =
            await this.statisticsService.findTrendingGamesForGameIds(
                gamesIds,
                StatisticsPeriod.WEEK,
            );
        const statistics = filteredGamesStatistics[0];
        const sortedGames = games.toSorted((firstGame, secondGame) => {
            const firstGameStatisticsIndex = statistics.findIndex(
                (statistics) => {
                    return (
                        statistics != undefined &&
                        statistics.gameId === firstGame.id
                    );
                },
            );
            if (firstGameStatisticsIndex === -1) {
                return -1;
            }
            const secondGameStatisticsIndex = statistics.findIndex(
                (statistics) => {
                    return (
                        statistics != undefined &&
                        statistics.gameId === secondGame.id
                    );
                },
            );
            if (secondGameStatisticsIndex === -1) {
                return 1;
            }
            console.log(firstGameStatisticsIndex, secondGameStatisticsIndex);

            return firstGameStatisticsIndex - secondGameStatisticsIndex;
        });

        return [sortedGames, FIXED_SORTED_GAMES_LIMIT];
    }
}
