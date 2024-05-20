import { GameStatistics } from "./entity/game-statistics.entity";
import { ReviewStatistics } from "./entity/review-statistics.entity";
import {
    StatisticsLikeAction,
    StatisticsViewAction,
} from "./statistics-queue/statistics-queue.types";
import { TPaginationData } from "../utils/pagination/pagination-response.dto";
import { StatisticsStatus } from "./dto/statistics-entity.dto";
import { ActivityStatistics } from "./entity/activity-statistics.entity";

export interface StatisticsService {
    create: (
        sourceId: string | number,
    ) => Promise<GameStatistics | ReviewStatistics | ActivityStatistics>;
    findOne: (
        sourceId: string | number,
    ) => Promise<GameStatistics | ReviewStatistics | ActivityStatistics | null>;
    handleLike: (data: StatisticsLikeAction) => Promise<void>;
    handleView: (data: StatisticsViewAction) => Promise<void>;
    findTrending: (
        data: any,
    ) => Promise<
        TPaginationData<GameStatistics | ReviewStatistics | ActivityStatistics>
    >;
    getStatus: (
        statisticsId: number,
        userId?: string,
    ) => Promise<StatisticsStatus>;
}
