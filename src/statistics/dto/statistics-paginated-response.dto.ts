import { PaginationInfo } from "../../utils/pagination/pagination-response.dto";
import { GameStatistics } from "../entity/game-statistics.entity";
import { ReviewStatistics } from "../entity/review-statistics.entity";
import { ActivityStatistics } from "../entity/activity-statistics.entity";

// Each 'statistics' entity should have its own class declaration to help
// OpenAPI schema generators parse the types.

export class GameStatisticsPaginatedResponseDto {
    data: GameStatistics[];
    pagination: PaginationInfo;
}

export class ReviewStatisticsPaginatedResponseDto {
    data: ReviewStatistics[];
    pagination: PaginationInfo;
}

export class ActivityStatisticsPaginatedResponseDto {
    data: ActivityStatistics[];
    pagination: PaginationInfo;
}
