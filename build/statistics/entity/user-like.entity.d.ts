import { GameStatistics } from "./game-statistics.entity";
import { ReviewStatistics } from "./review-statistics.entity";
export declare class UserLike {
    id: number;
    userId: string;
    gameStatistics: GameStatistics;
    reviewStatistics: ReviewStatistics;
}
