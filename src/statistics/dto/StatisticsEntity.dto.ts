import { Statistics } from "../entity/statistics.entity";
import { IntersectionType, OmitType } from "@nestjs/swagger";

export class StatisticsStatus {
    isLiked: boolean;
    isViewed: boolean;
}

export class StatisticsEntityDto extends IntersectionType(
    OmitType(Statistics, ["views", "likes"]),
    StatisticsStatus,
) {}
