import { Processor } from "@nestjs/bullmq";
import { Job } from "bullmq";
import {
    StatisticsCreateAction,
    StatisticsLikeAction,
    StatisticsViewAction,
} from "./statistics-queue.types";
import { STATISTICS_QUEUE_NAME } from "./statistics-queue.constants";
import { WorkerHostProcessor } from "../../utils/WorkerHostProcessor";
import { Logger } from "@nestjs/common";
import { StatisticsService } from "../statistics.service";

@Processor(STATISTICS_QUEUE_NAME, {
    concurrency: 5,
})
export class StatisticsQueueProcessor extends WorkerHostProcessor {
    logger = new Logger(StatisticsQueueProcessor.name);
    constructor(private readonly statisticsService: StatisticsService) {
        super();
    }

    async process(
        job: Job<
            StatisticsLikeAction | StatisticsViewAction | StatisticsCreateAction
        >,
    ) {
        if (job.name === "like") {
            await this.statisticsService.handleLike(
                job.data as StatisticsLikeAction,
            );
        } else if (job.name === "view") {
            await this.statisticsService.handleView(
                job.data as StatisticsViewAction,
            );
        } else if (job.name === "create") {
            await this.statisticsService.create(job.data);
        }

        return `${job.name}-${job.data.sourceType}-${job.data.sourceId}`;
    }
}
