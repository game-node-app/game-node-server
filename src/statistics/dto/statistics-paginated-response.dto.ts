import { Statistics } from "../entity/statistics.entity";
import { withPaginationResponse } from "../../utils/pagination/buildPaginationResponse";

export class StatisticsPaginatedResponseDto extends withPaginationResponse(
    Statistics,
) {}
