import {
    PaginationInfo,
    PaginationResponseDto,
} from "../../utils/pagination/pagination-response.dto";
import { ReviewComment } from "../entity/review-comment.entity";
import { ActivityComment } from "../entity/activity-comment.entity";

export class FindCommentsPaginatedResponseDto extends PaginationResponseDto {
    data: ReviewComment[] | ActivityComment[] = [];
    pagination: PaginationInfo = new PaginationInfo();
}
