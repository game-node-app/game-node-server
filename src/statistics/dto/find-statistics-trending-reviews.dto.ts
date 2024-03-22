import { IsEnum, IsNotEmpty, IsNumber, IsOptional } from "class-validator";
import { BaseFindDto } from "../../utils/base-find.dto";
import { Statistics } from "../entity/statistics.entity";
import { StatisticsPeriod } from "../statistics.constants";
import { OmitType } from "@nestjs/swagger";

export class FindStatisticsTrendingReviewsDto extends OmitType(
    BaseFindDto<Statistics>,
    ["orderBy", "search"],
) {
    @IsOptional()
    @IsNumber()
    gameId?: number;
    @IsNotEmpty()
    @IsEnum(StatisticsPeriod)
    period: StatisticsPeriod;
}
