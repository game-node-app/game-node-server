import { Controller, Get, Query } from "@nestjs/common";
import { ActivitiesFeedService } from "./activities-feed.service";
import { ApiTags } from "@nestjs/swagger";
import { ActivitiesFeedRequestDto } from "./dto/activities-feed-request.dto";

@ApiTags("activities-feed")
@Controller("activities-feed")
export class ActivitiesFeedController {
    constructor(
        private readonly activitiesFeedService: ActivitiesFeedService,
    ) {}

    @Get()
    async buildActivitiesFeed(@Query() dto: ActivitiesFeedRequestDto) {
        return this.activitiesFeedService.buildActivitiesFeed(undefined, dto);
    }
}
