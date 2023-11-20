import { Body, Controller, Delete, Post, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../../auth/auth.guard";
import { StatisticsActionDto } from "./dto/statistics-action.dto";
import { StatisticsQueueService } from "./statistics-queue.service";
import { Session } from "../../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { StatisticsActionType } from "../statistics.constants";
import { Public } from "../../auth/public.decorator";

@Controller("statistics/queue")
@ApiTags("statistics-queue")
@UseGuards(AuthGuard)
export class StatisticsQueueController {
    constructor(
        private readonly statisticsQueueService: StatisticsQueueService,
    ) {}

    @Post("like")
    async addLike(
        @Session() session: SessionContainer,
        @Body() dto: StatisticsActionDto,
    ) {
        const userId = session.getUserId();
        this.statisticsQueueService.registerLike(
            userId,
            dto,
            StatisticsActionType.INCREMENT,
        );
    }

    @Delete("like")
    async removeLike(
        @Session() session: SessionContainer,
        @Body() dto: StatisticsActionDto,
    ) {
        const userId = session.getUserId();
        this.statisticsQueueService.registerLike(
            userId,
            dto,
            StatisticsActionType.DECREMENT,
        );
    }

    @Post("view")
    @Public()
    async addView(
        @Body() dto: StatisticsActionDto,
        @Session() session?: SessionContainer,
    ) {
        const possibleUserId = session?.getUserId();
        this.statisticsQueueService.registerView(dto, possibleUserId);
    }
}
