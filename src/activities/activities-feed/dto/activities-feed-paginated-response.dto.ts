import { ActivitiesFeedEntryDto } from "./activities-feed-entry.dto";
import { PaginationInfo } from "../../../utils/pagination/pagination-response.dto";

export class ActivitiesFeedPaginatedResponseDto {
    data: ActivitiesFeedEntryDto[];
    pagination: PaginationInfo;
}
