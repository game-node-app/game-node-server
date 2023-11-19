import { BaseFindDto } from "../../utils/base-find.dto";
import { Statistics } from "../entity/statistics.entity";
import { StatisticsSourceType } from "../statistics.constants";
import { OmitType } from "@nestjs/swagger";

export class FindStatisticsDto extends OmitType(BaseFindDto<Statistics>, [
    "relations",
    "search",
]) {
    sourceType: StatisticsSourceType;
}
