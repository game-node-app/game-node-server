import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bull";
import { Queue } from "bull";
import { TStatisticsCounterAction } from "./statistics-game.types";

@Injectable()
export class StatisticsGameQueueService {
    constructor(@InjectQueue("statistics") private statisticsQueue: Queue) {}

    async registerGameView(gameId: number, userId?: string) {
        await this.statisticsQueue.add(
            "registerGameView",
            { gameId, userId },
            { delay: 3000 },
        );
    }

    async registerGameLike(
        gameId: number,
        userId: string,
        action: TStatisticsCounterAction,
    ) {
        await this.statisticsQueue.add("registerGameLike", {
            gameId,
            userId,
            action,
        });
    }
}
