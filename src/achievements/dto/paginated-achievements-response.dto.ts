import { PaginationInfo } from "../../utils/pagination/pagination-response.dto";
import { AchievementDto } from "./achievement.dto";

export class PaginatedAchievementsResponseDto {
    data: AchievementDto[];
    pagination: PaginationInfo;
}
