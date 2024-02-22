import { StatisticsSourceType } from "../statistics.constants";
import { IsNotEmpty } from "class-validator";

export class FindOneStatisticsDto {
    @IsNotEmpty()
    sourceId: string | number;
    @IsNotEmpty()
    sourceType: StatisticsSourceType;
}
