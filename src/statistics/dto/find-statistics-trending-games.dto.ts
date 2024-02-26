import { BaseFindDto } from "../../utils/base-find.dto";
import { Statistics } from "../entity/statistics.entity";
import { GameRepositoryFilterDto } from "../../game/game-repository/dto/game-repository-filter.dto";
import { IsEnum, IsNotEmpty, IsOptional } from "class-validator";
import { StatisticsPeriod } from "../statistics.constants";

export class FindStatisticsTrendingGamesDto extends BaseFindDto<Statistics> {
    @IsOptional()
    criteria?: GameRepositoryFilterDto;
    @IsNotEmpty()
    @IsEnum(StatisticsPeriod)
    period: StatisticsPeriod;
}
