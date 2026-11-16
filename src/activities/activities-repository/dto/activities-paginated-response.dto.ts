import { ApiProperty } from "@nestjs/swagger";
import { ActivityResponseDto } from "./activity-response.dto";
import { PaginationInfo } from "../../../utils/pagination/pagination-response.dto";

export class ActivitiesPaginatedResponseDto {
    @ApiProperty({ type: () => [ActivityResponseDto] })
    data: ActivityResponseDto[];
    pagination: PaginationInfo;
}
