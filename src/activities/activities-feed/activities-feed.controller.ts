import {
    Controller,
    Get,
    Query,
    UseGuards,
    UseInterceptors,
} from "@nestjs/common";
import { ActivitiesFeedService } from "./activities-feed.service";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { ActivitiesFeedRequestDto } from "./dto/activities-feed-request.dto";
import { PaginationInterceptor } from "../../interceptor/pagination.interceptor";
import { ActivitiesFeedPaginatedResponseDto } from "./dto/activities-feed-paginated-response.dto";
import { Session } from "../../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { Public } from "../../auth/public.decorator";
import { AuthGuard } from "../../auth/auth.guard";
import { SessionAwareCacheInterceptor } from "../../interceptor/session-aware-cache/session-aware-cache.interceptor";
import { CacheTTL } from "@nestjs/cache-manager";
import { minutes } from "@nestjs/throttler";

@ApiTags("activities-feed")
@Controller("activities/feed")
@UseGuards(AuthGuard)
export class ActivitiesFeedController {
    constructor(
        private readonly activitiesFeedService: ActivitiesFeedService,
    ) {}

    @Get()
    @UseInterceptors(SessionAwareCacheInterceptor)
    @CacheTTL(minutes(5))
    @UseInterceptors(PaginationInterceptor)
    @ApiOkResponse({
        type: ActivitiesFeedPaginatedResponseDto,
    })
    @Public()
    async buildActivitiesFeed(
        @Query() dto: ActivitiesFeedRequestDto,
        @Session() session: SessionContainer | undefined,
    ) {
        return this.activitiesFeedService.buildActivitiesFeed(
            session?.getUserId(),
            dto,
        );
    }
}
