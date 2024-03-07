import { NotificationAggregateDto } from "./notification-aggregate.dto";
import { PaginationInfo } from "../../utils/pagination/pagination-response.dto";

export class PaginatedNotificationAggregationDto {
    data: NotificationAggregateDto[];
    pagination: PaginationInfo;
}
