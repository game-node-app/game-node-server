import { Injectable } from "@nestjs/common";
import { StatisticsActionType } from "../statistics.constants";
import { STATISTICS_QUEUE_NAME } from "./statistics-queue.constants";
import { Queue } from "bull";
import {
    StatisticsLikeAction,
    StatisticsViewAction,
} from "./statistics-queue.types";
import { StatisticsActionDto } from "./dto/statistics-action.dto";
import { InjectQueue } from "@nestjs/bull";

@Injectable()
export class StatisticsQueueService {
    constructor(
        @InjectQueue(STATISTICS_QUEUE_NAME)
        private readonly statisticsQueue: Queue,
    ) {}

    registerLike(
        userId: string,
        dto: StatisticsActionDto,
        action: StatisticsActionType,
    ) {
        const likeAction: StatisticsLikeAction = {
            action,
            sourceId: dto.sourceId,
            sourceType: dto.sourceType,
            userId,
        };
        return this.statisticsQueue.add("like", likeAction);
    }

    registerView(dto: StatisticsActionDto, userId?: string) {
        const viewAction: StatisticsViewAction = {
            userId,
            sourceType: dto.sourceType,
            sourceId: dto.sourceId,
        };
        return this.statisticsQueue.add("view", viewAction);
    }
}
