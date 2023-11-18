import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ReviewStatistics } from "./entity/review-statistics.entity";
import { Repository } from "typeorm";
import { ReviewsService } from "../../reviews/reviews.service";
import { UserLike } from "../entity/user-like.entity";

@Injectable()
export class StatisticsReviewService {
    constructor(
        @InjectRepository(UserLike)
        private readonly userLikeRepository: Repository<UserLike>,
        @InjectRepository(ReviewStatistics)
        private readonly reviewStatisticsRepository: Repository<ReviewStatistics>,
        private readonly reviewService: ReviewsService,
    ) {}

    async handleLikeAction(
        userId: string,
        reviewId: string,
        action: "increment" | "decrement",
    ) {
        const review = await this.reviewService.findOneById(reviewId);
        if (review == null) {
            throw new HttpException(
                "Review doesn't exist",
                HttpStatus.BAD_REQUEST,
            );
        } else if (review.profile.userId !== userId) {
            throw new HttpException(
                "Attempt to update wrong user count",
                HttpStatus.NOT_ACCEPTABLE,
            );
        }

        let reviewStatistics = await this.reviewStatisticsRepository.findOneBy({
            review: {
                id: reviewId,
            },
        });
        if (reviewStatistics && action === "increment") {
            const alreadyLiked = await this.userLikeRepository.exist({
                where: {
                    reviewStatistics: {
                        id: reviewStatistics.id,
                    },
                },
            });
            if (alreadyLiked) {
                throw new HttpException(
                    "User has already registered a like for this review.",
                    HttpStatus.BAD_REQUEST,
                );
            }
        }
        if (!reviewStatistics) {
            reviewStatistics = await this.reviewStatisticsRepository.save({
                review: {
                    id: reviewId,
                },
                likesCount: 0,
            });
        }

        if (action === "increment") {
            await this.reviewStatisticsRepository.increment(
                {
                    id: reviewStatistics.id,
                },
                "likesCount",
                1,
            );
            await this.userLikeRepository.save({
                reviewStatistics: reviewStatistics,
                userId: userId,
            });
        } else {
            await this.reviewStatisticsRepository.decrement(
                {
                    id: reviewStatistics.id,
                },
                "likesCount",
                -1,
            );
            await this.userLikeRepository.delete({
                userId: userId,
                reviewStatistics: {
                    id: reviewStatistics.id,
                },
            });
        }
    }
}
