import { Processor } from "@nestjs/bullmq";
import { Job } from "bullmq";
import {
    StatisticsCreateAction,
    StatisticsLikeAction,
    StatisticsViewAction,
} from "./statistics-queue.types";
import { STATISTICS_QUEUE_NAME } from "./statistics-queue.constants";
import { WorkerHostProcessor } from "../../utils/WorkerHostProcessor";
import { GameStatisticsService } from "../game-statistics.service";
import { StatisticsSourceType } from "../statistics.constants";
import { ReviewStatisticsService } from "../review-statistics.service";
import { ActivityStatisticsService } from "../activity-statistics.service";
import { Logger } from "@nestjs/common";
import { StatisticsQueueService } from "./statistics-queue.service";
import { StatisticsService } from "../statistics.types";
import { CommentStatisticsService } from "../comment-statistics.service";

@Processor(STATISTICS_QUEUE_NAME)
export class StatisticsQueueProcessor extends WorkerHostProcessor {
    logger = new Logger(StatisticsQueueService.name);
    constructor(
        private readonly gameStatisticsService: GameStatisticsService,
        private readonly reviewStatisticsService: ReviewStatisticsService,
        private readonly activityStatisticsService: ActivityStatisticsService,
        private readonly commentStatisticsService: CommentStatisticsService,
    ) {
        super();
    }

    async process(
        job: Job<
            StatisticsLikeAction | StatisticsViewAction | StatisticsCreateAction
        >,
    ) {
        let targetService: StatisticsService;
        switch (job.data.sourceType) {
            case StatisticsSourceType.GAME:
                targetService = this.gameStatisticsService;
                break;
            case StatisticsSourceType.REVIEW:
                targetService = this.reviewStatisticsService;
                break;
            case StatisticsSourceType.ACTIVITY:
                targetService = this.activityStatisticsService;
                break;
            case StatisticsSourceType.REVIEW_COMMENT:
                targetService = this.commentStatisticsService;
                break;
            default:
                throw new Error(
                    `Invalid sourceType for job: ${job.id} - ${JSON.stringify(job.data)}`,
                );
        }

        if (job.name === "like") {
            await targetService.handleLike(job.data as StatisticsLikeAction);
        } else if (job.name === "view") {
            await targetService.handleView(job.data as StatisticsViewAction);
        } else if (job.name === "create") {
            await targetService.create(job.data);
        }
    }
}
