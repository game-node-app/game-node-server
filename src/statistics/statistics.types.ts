import { GameStatistics } from "./entity/game-statistics.entity";
import { ReviewStatistics } from "./entity/review-statistics.entity";
import {
    StatisticsCreateAction,
    StatisticsLikeAction,
    StatisticsViewAction,
} from "./statistics-queue/statistics-queue.types";
import { TPaginationData } from "../utils/pagination/pagination-response.dto";
import { StatisticsStatus } from "./dto/statistics-entity.dto";
import { ActivityStatistics } from "./entity/activity-statistics.entity";
import { CommentStatistics } from "./entity/comment-statistics.entity";
import { StatisticsSourceType } from "./statistics.constants";

type AnyStatistics =
    | GameStatistics
    | ReviewStatistics
    | ActivityStatistics
    | CommentStatistics;

export interface StatisticsService {
    create: (data: StatisticsCreateAction) => Promise<AnyStatistics>;
    findOne: (
        sourceId: string | number,
        sourceType?: StatisticsSourceType,
    ) => Promise<AnyStatistics | null>;
    handleLike: (data: StatisticsLikeAction) => Promise<void>;
    handleView: (data: StatisticsViewAction) => Promise<void>;
    findTrending: (data: any) => Promise<TPaginationData<AnyStatistics>>;
    getStatus: (
        statisticsId: number,
        userId?: string,
    ) => Promise<StatisticsStatus>;
}
