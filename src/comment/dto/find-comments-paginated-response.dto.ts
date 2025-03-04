import {
    PaginationInfo,
    PaginationResponseDto,
} from "../../utils/pagination/pagination-response.dto";
import { ApiProperty, getSchemaPath } from "@nestjs/swagger";
import {
    ActivityCommentDto,
    AnyCommentDto,
    PostCommentDto,
    ReviewCommentDto,
} from "./comment.dto";

export class FindCommentsPaginatedResponseDto extends PaginationResponseDto {
    @ApiProperty({
        type: "array",
        oneOf: [
            { $ref: getSchemaPath(ReviewCommentDto) },
            { $ref: getSchemaPath(ActivityCommentDto) },
            { $ref: getSchemaPath(PostCommentDto) },
        ],
    })
    data: AnyCommentDto[] = [];
    pagination: PaginationInfo = new PaginationInfo();
}
