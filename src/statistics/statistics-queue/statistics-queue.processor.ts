import { Processor } from "@nestjs/bullmq";
import { Job } from "bullmq";
import {
    StatisticsLikeAction,
    StatisticsViewAction,
} from "./statistics-queue.types";
import { STATISTICS_QUEUE_NAME } from "./statistics-queue.constants";
import { WorkerHostProcessor } from "../../utils/WorkerHostProcessor";
import { GameStatisticsService } from "../game-statistics.service";
import { StatisticsSourceType } from "../statistics.constants";
import { ReviewStatisticsService } from "../review-statistics.service";

@Processor(STATISTICS_QUEUE_NAME)
export class StatisticsQueueProcessor extends WorkerHostProcessor {
    constructor(
        private readonly gameStatisticsService: GameStatisticsService,
        private readonly reviewStatisticsRepository: ReviewStatisticsService,
    ) {
        super();
    }

    async process(job: Job<StatisticsLikeAction | StatisticsViewAction>) {
        if (job.name === "like") {
            try {
                switch (job.data.sourceType) {
                    case StatisticsSourceType.GAME:
                        await this.gameStatisticsService.handleLike(
                            job.data as StatisticsLikeAction,
                        );
                        break;
                    case StatisticsSourceType.REVIEW:
                        await this.reviewStatisticsRepository.handleLike(
                            job.data as StatisticsLikeAction,
                        );
                }
            } catch (e) {
                console.error(e);
            }
        } else if (job.name === "view") {
            try {
                switch (job.data.sourceType) {
                    case StatisticsSourceType.GAME:
                        await this.gameStatisticsService.handleView(job.data);
                        break;
                    case StatisticsSourceType.REVIEW:
                        await this.reviewStatisticsRepository.handleView(
                            job.data,
                        );
                }
            } catch (e) {
                console.error(e);
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
                        await this.reviewStatisticsRepository.create(
                            job.data.sourceId as string,
                        );
                        break;
                }
            } catch (e) {
                console.error(e);
            }
        }
    }
}
