import { GameStatistics } from "./entity/game-statistics.entity";
import { ReviewStatistics } from "./entity/review-statistics.entity";
import { ActivityStatistics } from "./entity/activity-statistics.entity";
import { CommentStatistics } from "./entity/comment-statistics.entity";
import { PostStatistics } from "./entity/post-statistics.entity";

export type AnyStatistics =
    | GameStatistics
    | ReviewStatistics
    | ActivityStatistics
    | CommentStatistics
    | PostStatistics;
