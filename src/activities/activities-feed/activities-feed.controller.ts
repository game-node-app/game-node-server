import { Controller } from "@nestjs/common";
import { ActivitiesFeedService } from "./activities-feed.service";

@Controller("activities-feed")
export class ActivitiesFeedController {
    constructor(
        private readonly activitiesFeedService: ActivitiesFeedService,
    ) {}
}
