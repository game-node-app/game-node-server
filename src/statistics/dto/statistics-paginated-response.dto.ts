import { Statistics } from "../entity/statistics.entity";
import { PaginationInfo } from "../../utils/pagination/pagination-response.dto";

export class StatisticsPaginatedResponseDto {
    data: Statistics[];
    pagination: PaginationInfo;
}
