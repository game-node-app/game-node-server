import { StatisticsSourceType } from "../../statistics.constants";
import { IsEnum, IsNotEmpty, IsString } from "class-validator";
import { Transform } from "class-transformer";

export class StatisticsActionDto {
    @IsNotEmpty()
    @IsString()
    @Transform(({ value }) => (typeof value === "number" ? `${value}` : value))
    sourceId: string;
    @IsNotEmpty()
    @IsEnum(StatisticsSourceType)
    sourceType: StatisticsSourceType;
}
