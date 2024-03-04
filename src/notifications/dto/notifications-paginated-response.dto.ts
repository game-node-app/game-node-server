import { PaginationInfo } from "../../utils/pagination/pagination-response.dto";
import { NotificationAggregateDto } from "./notification-aggregate.dto";

export class NotificationsPaginatedResponseDto {
    data: NotificationAggregateDto[];
    pagination: PaginationInfo;
}
