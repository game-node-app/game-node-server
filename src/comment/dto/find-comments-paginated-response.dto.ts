import {
    PaginationInfo,
    PaginationResponseDto,
} from "../../utils/pagination/pagination-response.dto";
import { ReviewComment } from "../entity/review-comment.entity";

export class FindCommentsPaginatedResponseDto extends PaginationResponseDto {
    data: ReviewComment[] = [];
    pagination: PaginationInfo = new PaginationInfo();
}
