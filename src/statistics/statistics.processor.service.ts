import { Processor, Process } from "@nestjs/bull";
import { Job } from "bull";
import { InjectRepository } from "@nestjs/typeorm";
import { StatisticsGameService } from "./statistics.game.service";

@Processor("statistics")
export class StatisticsProcessorService {
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
