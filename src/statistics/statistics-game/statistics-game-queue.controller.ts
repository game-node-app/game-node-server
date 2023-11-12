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
import { StatisticsGameQueueService } from "./statistics-game-queue.service";
import { CacheInterceptor } from "@nestjs/cache-manager";
import { ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../../auth/auth.guard";
import { Public } from "../../auth/public.decorator";

@Controller("statistics/game")
@UseGuards(AuthGuard)
@ApiTags("statistics")
@UseInterceptors(CacheInterceptor)
export class StatisticsGameQueueController {
    constructor(private statisticsQueueService: StatisticsGameQueueService) {}

    @Post(":id/view")
    @Public()
    async registerGameView(
        @Session() session: SessionContainer,
        @Param("id") gameId: number,
    ) {
        const userId = session ? session.getUserId() : undefined;
        await this.statisticsQueueService.registerGameView(gameId, userId);
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
}
