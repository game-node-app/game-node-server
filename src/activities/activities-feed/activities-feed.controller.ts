import { Controller, Get, Query, UseInterceptors } from "@nestjs/common";
import { ActivitiesFeedService } from "./activities-feed.service";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { ActivitiesFeedRequestDto } from "./dto/activities-feed-request.dto";
import { PaginationInterceptor } from "../../interceptor/pagination.interceptor";
import { ActivitiesFeedPaginatedResponseDto } from "./dto/activities-feed-paginated-response.dto";
import { Session } from "../../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { CacheInterceptor, CacheTTL } from "@nestjs/cache-manager";
import { minutes } from "@nestjs/throttler";

@ApiTags("activities-feed")
@Controller("activities/feed")
export class ActivitiesFeedController {
    constructor(
        private readonly activitiesFeedService: ActivitiesFeedService,
    ) {}

    @Get()
    @UseInterceptors(CacheInterceptor)
    @CacheTTL(minutes(5))
    @UseInterceptors(PaginationInterceptor)
    @ApiOkResponse({
        type: ActivitiesFeedPaginatedResponseDto,
    })
    async buildActivitiesFeed(
        @Query() dto: ActivitiesFeedRequestDto,
        @Session() session?: SessionContainer,
    ) {
        return this.activitiesFeedService.buildActivitiesFeed(
            session?.getUserId(),
            dto,
        );
    }
}
