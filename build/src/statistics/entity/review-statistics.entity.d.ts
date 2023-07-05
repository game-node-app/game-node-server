import { UserLike } from "./user-like.entity";
import { Review } from "../../reviews/entities/review.entity";
export declare class ReviewStatistics {
    id: number;
    review: Review;
    likes: UserLike[];
}
