import { Processor } from "@nestjs/bullmq";
import { StatisticsService } from "../statistics.service";
import { Job } from "bullmq";
import {
    StatisticsLikeAction,
    StatisticsViewAction,
} from "./statistics-queue.types";
import { STATISTICS_QUEUE_NAME } from "./statistics-queue.constants";
import { WorkerHostProcessor } from "../../utils/WorkerHostProcessor";

@Processor(STATISTICS_QUEUE_NAME)
export class StatisticsQueueProcessor extends WorkerHostProcessor {
    constructor(private readonly statisticsService: StatisticsService) {
        super();
    }

    async process(job: Job<StatisticsLikeAction | StatisticsViewAction>) {
        if (job.name === "like") {
            try {
                await this.statisticsService.handleLike(
                    job.data as StatisticsLikeAction,
                );
            } catch (e) {
                console.error(e);
            }
        } else if (job.name === "view") {
            try {
                await this.statisticsService.handleView(
                    job.data as StatisticsViewAction,
                );
            } catch (e) {
                console.error(e);
            }
        }
    }
}
