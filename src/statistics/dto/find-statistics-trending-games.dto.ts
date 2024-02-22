import { BaseFindDto } from "../../utils/base-find.dto";
import { Statistics } from "../entity/statistics.entity";
import { GameRepositoryFilterDto } from "../../game/game-repository/dto/game-repository-filter.dto";
import { StatisticsPeriod } from "../statistics.constants";

export class FindStatisticsTrendingGamesDto extends BaseFindDto<Statistics> {
    criteria: GameRepositoryFilterDto;
    period: StatisticsPeriod;
}
