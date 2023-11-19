import { Process, Processor } from "@nestjs/bull";
import { StatisticsService } from "../statistics.service";
import { Job } from "bull";
import {
    StatisticsLikeAction,
    StatisticsViewAction,
} from "./statistics-queue.types";
import { STATISTICS_QUEUE_NAME } from "./statistics-queue.constants";

@Processor(STATISTICS_QUEUE_NAME)
export class StatisticsQueueProcessor {
    constructor(private readonly statisticsService: StatisticsService) {}

    @Process("like")
    async processLikes(job: Job<StatisticsLikeAction>) {
        try {
            await this.statisticsService.handleLike(job.data);
        } catch (e) {
            console.error(e);
        }
    }

    @Process("view")
    async processViews(job: Job<StatisticsViewAction>) {
        try {
            await this.statisticsService.handleView(job.data);
        } catch (e) {
            console.error(e);
        }
    }
}
