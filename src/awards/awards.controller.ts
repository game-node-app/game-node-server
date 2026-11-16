import {
    Controller,
    Get,
    NotFoundException,
    Param,
    UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { ApiTags } from "@nestjs/swagger";
import { AwardsService } from "./awards.service";
import { Public } from "../auth/public.decorator";
import { AwardsResultService } from "./result/awards-result.service";

@Controller("awards")
@UseGuards(AuthGuard)
@ApiTags("awards")
export class AwardsController {
    constructor(
        private readonly awardsService: AwardsService,
        private readonly awardsResultService: AwardsResultService,
    ) {}

    // Must stay before events/:id so Nest does not treat "current" as an id.
    @Get("events/current")
    @Public()
    public async getCurrentEvent() {
        const event = await this.awardsService.getCurrentEvent();
        if (event == null) {
            throw new NotFoundException("No awards event has started yet.");
        }
        return event;
    }

    @Get("events/:id")
    @Public()
    public async getEventById(@Param("id") id: number) {
        return this.awardsService.getEventByIdOrFail(id);
    }

    @Public()
    @Get("events/year/:year")
    public async getEventsByYear(@Param("year") year: number) {
        return this.awardsService.getEventByYearOrFail(year);
    }

    @Get("events")
    @Public()
    public async getEvents() {
        return this.awardsService.getEvents();
    }

    @Get(":eventId/categories")
    @Public()
    public async getCategoriesByEventId(@Param("eventId") eventId: number) {
        return this.awardsService.getCategoriesByEventId(eventId);
    }

    @Get(":eventId/results")
    @Public()
    public async getResultsByEventId(@Param("eventId") eventId: number) {
        return this.awardsResultService.getCategoryResultsByEventId(eventId);
    }

    @Get(":eventId/scoreboard/:userId")
    @Public()
    public async getScoreboard(
        @Param("eventId") eventId: number,
        @Param("userId") userId: string,
    ) {
        return this.awardsResultService.getScoreboard(eventId, userId);
    }
}
