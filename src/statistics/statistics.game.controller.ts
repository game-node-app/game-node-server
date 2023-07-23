import {
    Controller,
    Delete,
    Get,
    Param,
    Post,
    UseInterceptors,
} from "@nestjs/common";
import { Session } from "../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { StatisticsQueueService } from "./statistics.queue.service";
import { StatisticsGameService } from "./statistics.game.service";
import { CacheInterceptor, CacheTTL } from "@nestjs/cache-manager";

/**
 * StatisticsGameController
 *
 * Keep in mind this controller does not return actual GameMetadata, but only GameStatistics.
 * The client will have to make a separate request to the IGDB API (using our IGDBModule) to get the actual GameMetadata.
 */
@Controller("statistics/game")
@UseInterceptors(CacheInterceptor)
export class StatisticsGameController {
    constructor(
        private statisticsQueueService: StatisticsQueueService,
        private statisticsGameService: StatisticsGameService,
    ) {}

    @Get("popular")
    async getMostPopularGames() {
        return await this.statisticsGameService.findAllByMostPopular();
    }

    @Post(":id/view")
    async registerGameView(
        @Session() session: SessionContainer,
        @Param("id") igdbId: number,
    ) {
        await this.statisticsQueueService.registerGameView(
            igdbId,
            session.getUserId(),
        );
    }

    @Post(":id/like")
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

    @Get(":id")
    async getGameStatistics(@Param("id") igdbId: number) {
        return await this.statisticsGameService.findOneById(igdbId);
    }
}
