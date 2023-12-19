import { BaseFindDto } from "../../utils/base-find.dto";
import { Statistics } from "../entity/statistics.entity";
import { StatisticsSourceType } from "../statistics.constants";
import { OmitType } from "@nestjs/swagger";
import { IsNotEmpty, IsNumber, IsString } from "class-validator";

export class FindStatisticsDto extends OmitType(BaseFindDto<Statistics>, [
    "search",
]) {
    @IsNotEmpty()
    @IsNumber()
    minimumItems: number;
    @IsNotEmpty()
    @IsString()
    sourceType: StatisticsSourceType;
}
