import {
    Controller,
    Delete,
    Get,
    Param,
    Post,
    UseGuards,
    UseInterceptors,
} from "@nestjs/common";
import { Session } from "../../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { StatisticsQueueService } from "./statistics-queue.service";
import { StatisticsGameService } from "../statistics-game/statistics-game.service";
import { CacheInterceptor } from "@nestjs/cache-manager";
import { ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../../auth/auth.guard";
import { Public } from "../../auth/public.decorator";

@Controller("statistics/game")
@UseGuards(AuthGuard)
@ApiTags("statistics")
@UseInterceptors(CacheInterceptor)
export class StatisticsQueueGameController {
    constructor(
        private statisticsQueueService: StatisticsQueueService,
        private statisticsGameService: StatisticsGameService,
    ) {}

    @Post(":id/view")
    @Public()
    async registerGameView(
        @Session() session: SessionContainer,
        @Param("id") igdbId: number,
    ) {
        const userId = session ? session.getUserId() : undefined;
        await this.statisticsQueueService.registerGameView(igdbId, userId);
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
        return await this.statisticsGameService.findOneByGameId(igdbId);
    }
}
