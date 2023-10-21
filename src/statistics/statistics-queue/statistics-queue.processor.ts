import { Processor, Process } from "@nestjs/bull";
import { Job } from "bull";
import { StatisticsGameService } from "../statistics-game/statistics-game.service";

@Processor("statistics")
export class StatisticsQueueProcessor {
    constructor(private statisticsGameService: StatisticsGameService) {}

    @Process("registerGameView")
    async handleRegisterGameView(job: Job) {
        const { gameId, userId } = job.data;
        await this.statisticsGameService.handleGameStatisticsViews(
            gameId,
            userId,
        );
    }

    @Process("registerGameLike")
    async handleRegisterGameLike(job: Job) {
        const { gameId, userId, action } = job.data;
        await this.statisticsGameService.handleGameStatisticsLikes(
            gameId,
            userId,
            action,
        );
    }
}
