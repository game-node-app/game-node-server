import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Put,
    Query,
    Sse,
    UseGuards,
    UseInterceptors,
} from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { NotificationsService } from "./notifications.service";
import { Session } from "../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { AuthGuard } from "../auth/auth.guard";
import { flatMap, interval, Observable } from "rxjs";
import { FindNotificationsDto } from "./dto/find-notifications.dto";
import { NotificationViewUpdateDto } from "./dto/notification-view-update.dto";
import { MessageEvent } from "@nestjs/common";
import { fromPromise } from "rxjs/internal/observable/innerFrom";
import { PaginationInterceptor } from "../interceptor/pagination.interceptor";
import { PaginatedNotificationAggregationDto } from "./dto/paginated-notification-aggregation.dto";
import { minutes, seconds, ThrottlerGuard } from "@nestjs/throttler";
import { CacheInterceptor, CacheTTL } from "@nestjs/cache-manager";

const NOTIFICATIONS_CHECK_INTERVAL = 60000;

@Controller("notifications")
@ApiTags("notifications")
@UseGuards(AuthGuard)
export class NotificationsController {
    constructor(private readonly notificationsService: NotificationsService) {}

    @Get()
    @UseInterceptors(PaginationInterceptor)
    @UseGuards(ThrottlerGuard)
    @ApiOkResponse({
        status: 200,
        type: PaginatedNotificationAggregationDto,
    })
    async findAllAndAggregate(
        @Session() session: SessionContainer,
        @Query() dto: FindNotificationsDto,
    ) {
        return this.notificationsService.findAllAndAggregate(
            session.getUserId(),
            dto,
        );
    }

    @Put(":id/view")
    @UseGuards(ThrottlerGuard)
    @HttpCode(HttpStatus.OK)
    async updateViewedStatus(
        @Session() session: SessionContainer,
        @Param("id") notificationId: number,
        @Body() dto: NotificationViewUpdateDto,
    ) {
        await this.notificationsService.updateViewedStatus(
            session.getUserId(),
            notificationId,
            dto.isViewed,
        );
    }

    @Sse("stream")
    async stream(
        @Session() session: SessionContainer,
    ): Promise<Observable<MessageEvent>> {
        return interval(NOTIFICATIONS_CHECK_INTERVAL).pipe(
            flatMap((num, index) => {
                return fromPromise(
                    this.notificationsService.findNewNotifications(
                        session.getUserId(),
                        index === 0,
                    ),
                );
            }),
        );
    }
}
