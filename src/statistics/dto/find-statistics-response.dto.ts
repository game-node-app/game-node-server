import { Statistics } from "../entity/statistics.entity";
import { PaginationInfo } from "../../utils/pagination/pagination-response.dto";
import { Transform } from "class-transformer";
import { resolveSourceIdsTypes } from "../statistics.utils";

export class FindStatisticsResponseDto<T> {
    @Transform(({ value }) => {
        return resolveSourceIdsTypes(value);
    })
    data: Statistics<T>[];
    pagination: PaginationInfo;
}
