import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bull";
import { Queue } from "bull";

@Injectable()
export class StatisticsQueueService {
    constructor(@InjectQueue("statistics") private statisticsQueue: Queue) {}

    async registerGameView(igdbId: number) {
        await this.statisticsQueue.add(
            "registerGameView",
            { igdbId },
            { delay: 3000 },
        );
    }

    async registerGameLike(igdbId: number, userId?: string) {
        await this.statisticsQueue.add("registerGameLike", { igdbId, userId });
    }
}
