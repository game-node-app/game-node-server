import { GameStatistics } from "./entity/game-statistics.entity";
import { ReviewStatistics } from "./entity/review-statistics.entity";
import {
    StatisticsLikeAction,
    StatisticsViewAction,
} from "./statistics-queue/statistics-queue.types";
import { TPaginationData } from "../utils/pagination/pagination-response.dto";
import { StatisticsStatus } from "./dto/statistics-entity.dto";

export interface StatisticsService {
    create: (
        sourceId: string | number,
    ) => Promise<GameStatistics | ReviewStatistics>;
    findOne: (
        sourceId: string | number,
    ) => Promise<GameStatistics | ReviewStatistics | null>;
    handleLike: (data: StatisticsLikeAction) => void;
    handleView: (data: StatisticsViewAction) => void;
    findTrending: (data: any) => Promise<TPaginationData<any>>;
    getStatus: (
        statisticsId: number,
        userId?: string,
    ) => Promise<StatisticsStatus>;
}
