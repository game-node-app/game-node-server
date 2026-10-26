import { Injectable, Logger } from "@nestjs/common";
import { STATISTICS_QUEUE_NAME } from "./statistics-queue.constants";
import { Queue } from "bullmq";
import {
    StatisticsCreateAction,
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

    /**
     * <strong>Important</strong>: it's not always the best call to use this whenever a new entry is created
     * e.g. when a game is imported via {@link IgdbSyncService} - clogging this queue will make all the others
     * not work until everything is processed.
     * @param data
     */
    createStatistics(data: StatisticsCreateAction) {
        this.statisticsQueue
            .add("create", data)
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
