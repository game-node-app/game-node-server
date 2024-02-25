import { IsEnum, IsNotEmpty, IsNumber } from "class-validator";
import { StatisticsSourceType } from "../statistics.constants";

export class StatisticsStatusRequestDto {
    @IsNotEmpty()
    @IsNumber()
    statisticsId: number;
    @IsNotEmpty()
    @IsEnum(StatisticsSourceType)
    sourceType: StatisticsSourceType;
}
