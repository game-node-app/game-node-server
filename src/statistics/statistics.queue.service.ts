import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bull";
import { Queue } from "bull";
import { TStatisticsCounterAction } from "./statistics.types";

@Injectable()
export class StatisticsQueueService {
    constructor(@InjectQueue("statistics") private statisticsQueue: Queue) {}

    async registerGameView(igdbId: number, userId?: string) {
        await this.statisticsQueue.add(
            "registerGameView",
            { igdbId, userId },
            { delay: 3000 },
        );
    }

    async registerGameLike(
        igdbId: number,
        userId: string,
        action: TStatisticsCounterAction,
    ) {
        await this.statisticsQueue.add("registerGameLike", {
            igdbId,
            userId,
            action,
        });
    }
}
