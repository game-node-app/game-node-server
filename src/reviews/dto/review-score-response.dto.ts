/**
 * Number of times a given review rating appears for a specific game
 */
export class ReviewScoreDistribution {
    1: number;
    2: number;
    3: number;
    4: number;
    5: number;
    /**
     * Total number of reviews
     */
    total: number;
}

export class ReviewScoreResponseDto {
    median: number;
    distribution: ReviewScoreDistribution;
}
