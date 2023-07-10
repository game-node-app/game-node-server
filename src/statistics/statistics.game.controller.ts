import { Controller, Delete, Get, Param } from "@nestjs/common";
import { Session } from "../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { StatisticsQueueService } from "./statistics.queue.service";

@Controller("statistics/game")
export class StatisticsGameController {
    constructor(private statisticsQueueService: StatisticsQueueService) {}

    @Get(":id/view")
    async registerGameView(
        @Session() session: SessionContainer,
        @Param("id") igdbId: number,
    ) {
        await this.statisticsQueueService.registerGameView(
            igdbId,
            session.getUserId(),
        );
    }

    @Get(":id/like")
    async registerGameLikeIncrement(
        @Session() session: SessionContainer,
        @Param("id") igdbId: number,
    ) {
        await this.statisticsQueueService.registerGameLike(
            igdbId,
            session.getUserId(),
            "increment",
        );
    }

    @Delete(":id/like")
    async registerGameLikeDecrement(
        @Session() session: SessionContainer,
        @Param("id") igdbId: number,
    ) {
        await this.statisticsQueueService.registerGameLike(
            igdbId,
            session.getUserId(),
            "decrement",
        );
    }
}
