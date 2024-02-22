import { StatisticsPeriod } from "../statistics.constants";
import { IsEnum, IsNotEmpty, IsNumber, IsOptional } from "class-validator";
import { BaseFindDto } from "../../utils/base-find.dto";
import { Statistics } from "../entity/statistics.entity";

export class FindStatisticsTrendingReviewsDto extends BaseFindDto<Statistics> {
    @IsOptional()
    @IsNumber()
    gameId?: number;
    @IsNotEmpty()
    @IsEnum(StatisticsPeriod)
    period: StatisticsPeriod;
}
