import { PaginationInfo } from "../../../utils/pagination/pagination-response.dto";
import { Activity } from "../../activities-repository/entities/activity.entity";

export class ActivitiesFeedPaginatedResponseDto {
    data: Activity[];
    pagination: PaginationInfo;
}
