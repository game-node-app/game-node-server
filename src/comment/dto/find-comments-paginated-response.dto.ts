import {
    PaginationInfo,
    PaginationResponseDto,
} from "../../utils/pagination/pagination-response.dto";
import { ReviewComment } from "../entity/review-comment.entity";
import { ActivityComment } from "../entity/activity-comment.entity";
import { ApiProperty, getSchemaPath } from "@nestjs/swagger";

export class FindCommentsPaginatedResponseDto extends PaginationResponseDto {
    @ApiProperty({
        type: "array",
        oneOf: [
            { $ref: getSchemaPath(ReviewComment) },
            { $ref: getSchemaPath(ActivityComment) },
        ],
    })
    data: ReviewComment[] | ActivityComment[] = [];
    pagination: PaginationInfo = new PaginationInfo();
}
