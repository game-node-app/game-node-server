import { Injectable, Logger } from "@nestjs/common";
import { StatisticsActionType } from "../statistics.constants";
import { STATISTICS_QUEUE_NAME } from "./statistics-queue.constants";
import { Queue } from "bullmq";
import {
    StatisticsLikeAction,
    StatisticsViewAction,
} from "./statistics-queue.types";
import { StatisticsActionDto } from "./dto/statistics-action.dto";
import { InjectQueue } from "@nestjs/bullmq";

@Injectable()
export class StatisticsQueueService {
    private logger = new Logger(StatisticsQueueService.name);
    constructor(
        @InjectQueue(STATISTICS_QUEUE_NAME)
        private readonly statisticsQueue: Queue,
    ) {}

    createStatistics(data: StatisticsActionDto) {
        this.statisticsQueue
            .add("create", data)
            .then()
            .catch((err) => {
                this.logger.error(err);
            });
    }

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
            targetUserId: dto.targetUserId,
        };
        this.statisticsQueue
            .add("like", likeAction)
            .then()
            .catch((err) => {
                this.logger.error(err);
            });
    }

    registerView(dto: StatisticsActionDto, userId?: string) {
        const viewAction: StatisticsViewAction = {
            userId,
            targetUserId: dto.targetUserId,
            sourceType: dto.sourceType,
            sourceId: dto.sourceId,
        };

        this.statisticsQueue
            .add("view", viewAction)
            .then()
            .catch((err) => {
                this.logger.error(err);
            });
    }
}
