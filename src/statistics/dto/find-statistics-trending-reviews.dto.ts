import {
    IsEnum,
    IsNumber,
    IsOptional,
    IsString,
    Length,
} from "class-validator";
import { BaseFindDto } from "../../utils/base-find.dto";
import { Statistics } from "../entity/statistics.entity";
import { StatisticsPeriod } from "../statistics.constants";
import { OmitType } from "@nestjs/swagger";

export class FindStatisticsTrendingReviewsDto extends OmitType(
    BaseFindDto<Statistics>,
    ["orderBy", "search"],
) {
    /**
     * Usually, this property should not be used unless a specific review needs to be retrieved, and it's easier to just
     * call the statistics controller.
     */
    @IsOptional()
    @IsString()
    reviewId?: string;
    @IsOptional()
    @IsNumber()
    gameId?: number;
    @IsOptional()
    @IsString()
    @Length(36)
    userId?: string;
    @IsOptional()
    @IsEnum(StatisticsPeriod)
    period: StatisticsPeriod = StatisticsPeriod.ALL;
}
