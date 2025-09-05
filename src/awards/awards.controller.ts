import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { ApiTags } from "@nestjs/swagger";
import { AwardsService } from "./awards.service";

@Controller("awards")
@UseGuards(AuthGuard)
@ApiTags("awards")
export class AwardsController {
    constructor(private readonly awardsService: AwardsService) {}

    @Get("events/:id")
    public async getEventById(@Param("id") id: number) {
        return this.awardsService.getEventByIdOrFail(id);
    }

    @Get("events/year/:year")
    public async getEventsByYear(@Param("year") year: number) {
        return this.awardsService.getEventByIdOrFail(year);
    }

    @Get("events")
    public async getEvents() {
        return this.awardsService.getEvents();
    }

    @Get(":eventId/categories")
    public async getCategoriesByEventId(@Param("eventId") eventId: number) {
        return this.awardsService.getCategoriesByEventId(eventId);
    }
}
