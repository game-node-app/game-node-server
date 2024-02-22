import { StatisticsSourceType } from "../../statistics.constants";
import { IsEnum, IsNotEmpty } from "class-validator";

export class StatisticsActionDto {
    @IsNotEmpty()
    sourceId: string | number;
    @IsNotEmpty()
    @IsEnum(StatisticsSourceType)
    sourceType: StatisticsSourceType;
}
