import { Controller, Get, Query, UseInterceptors } from "@nestjs/common";
import { ActivitiesFeedService } from "./activities-feed.service";
import { ApiTags } from "@nestjs/swagger";
import { ActivitiesFeedRequestDto } from "./dto/activities-feed-request.dto";
import { PaginationInterceptor } from "../../interceptor/pagination.interceptor";

@ApiTags("activities-feed")
@Controller("activities/feed")
export class ActivitiesFeedController {
    constructor(
        private readonly activitiesFeedService: ActivitiesFeedService,
    ) {}

    @Get()
    @UseInterceptors(PaginationInterceptor)
    async buildActivitiesFeed(@Query() dto: ActivitiesFeedRequestDto) {
        return this.activitiesFeedService.buildActivitiesFeed(undefined, dto);
    }
}
