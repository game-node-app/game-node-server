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

@Processor(STATISTICS_QUEUE_NAME)
export class StatisticsQueueProcessor extends WorkerHostProcessor {
    logger = new Logger(StatisticsQueueService.name);
    constructor(
        private readonly gameStatisticsService: GameStatisticsService,
        private readonly reviewStatisticsService: ReviewStatisticsService,
        private readonly activityStatisticsService: ActivityStatisticsService,
    ) {
        super();
    }

    async process(
        job: Job<
            StatisticsLikeAction | StatisticsViewAction | StatisticsCreateAction
        >,
    ) {
        if (job.name === "like") {
            try {
                switch (job.data.sourceType) {
                    case StatisticsSourceType.GAME:
                        await this.gameStatisticsService.handleLike(
                            job.data as StatisticsLikeAction,
                        );
                        break;
                    case StatisticsSourceType.REVIEW:
                        await this.reviewStatisticsService.handleLike(
                            job.data as StatisticsLikeAction,
                        );
                        break;
                    case StatisticsSourceType.ACTIVITY:
                        await this.activityStatisticsService.handleLike(
                            job.data as StatisticsLikeAction,
                        );
                }
            } catch (e) {
                this.logger.error(e);
            }
        } else if (job.name === "view") {
            try {
                switch (job.data.sourceType) {
                    case StatisticsSourceType.GAME:
                        await this.gameStatisticsService.handleView(job.data);
                        break;
                    case StatisticsSourceType.REVIEW:
                        await this.reviewStatisticsService.handleView(job.data);
                        break;
                    case StatisticsSourceType.ACTIVITY:
                        await this.activityStatisticsService.handleView(
                            job.data,
                        );
                }
            } catch (e) {
                this.logger.error(e);
            }
        } else if (job.name === "create") {
            try {
                switch (job.data.sourceType) {
                    case StatisticsSourceType.GAME:
                        await this.gameStatisticsService.create(
                            job.data.sourceId as number,
                        );
                        break;
                    case StatisticsSourceType.REVIEW:
                        await this.reviewStatisticsService.create(
                            job.data.sourceId as string,
                        );
                        break;
                    case StatisticsSourceType.ACTIVITY:
                        await this.activityStatisticsService.create(
                            job.data.sourceId as string,
                        );
                        break;
                }
            } catch (e) {
                this.logger.error(e);
            }
        }
    }
}
