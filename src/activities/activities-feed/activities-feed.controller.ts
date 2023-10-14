import { Controller } from "@nestjs/common";
import { ActivitiesFeedService } from "./activities-feed.service";
import { ApiTags } from "@nestjs/swagger";

@ApiTags("activities-feed")
@Controller("activities-feed")
export class ActivitiesFeedController {
    constructor(
        private readonly activitiesFeedService: ActivitiesFeedService,
    ) {}
}
