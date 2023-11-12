import { Review } from "../entities/review.entity";
import { PaginationInfo } from "../../utils/pagination/pagination-response.dto";

export class FindReviewPaginatedDto {
    data: Review[];
    pagination: PaginationInfo;
}
