import { Activity } from "../entities/activity.entity";
import { PaginationInfo } from "../../../utils/pagination/pagination-response.dto";

export class ActivitiesPaginatedResponseDto {
    data: Activity[];
    pagination: PaginationInfo;
}
