import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { StatisticsRankingService } from "./statistics-ranking.service";

@Injectable()
export class StatisticsRankingScheduler {
    private readonly logger = new Logger(StatisticsRankingScheduler.name);
    private running = false;

    constructor(private readonly rankingService: StatisticsRankingService) {}

    @Cron(CronExpression.EVERY_30_SECONDS)
    async refresh(): Promise<void> {
        if (this.running) return;
        this.running = true;
        try {
            await this.rankingService.refreshCommonScores();
        } catch {
            this.logger.warn("Statistics ranking refresh failed; previous complete keys remain available");
        } finally {
            this.running = false;
        }
    }
}
