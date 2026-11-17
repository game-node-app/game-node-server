import { ApiProperty } from "@nestjs/swagger";
import { PaginationInfo } from "../../../utils/pagination/pagination-response.dto";
import { ActivityResponseDto } from "../../activities-repository/dto/activity-response.dto";

export class ActivitiesFeedPaginatedResponseDto {
    @ApiProperty({ type: () => [ActivityResponseDto] })
    data: ActivityResponseDto[];
    pagination: PaginationInfo;
}
