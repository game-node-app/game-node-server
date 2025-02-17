import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Put,
    Query,
    UseGuards,
    UseInterceptors,
} from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { NotificationsService } from "./notifications.service";
import { Session } from "../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { AuthGuard } from "../auth/auth.guard";
import { FindNotificationsDto } from "./dto/find-notifications.dto";
import { NotificationViewUpdateDto } from "./dto/notification-view-update.dto";
import { PaginationInterceptor } from "../interceptor/pagination.interceptor";
import { PaginatedNotificationAggregationDto } from "./dto/paginated-notification-aggregation.dto";
import { ThrottlerGuard } from "@nestjs/throttler";
import { Notification } from "./entity/notification.entity";

@Controller("notifications")
@ApiTags("notifications")
@UseGuards(AuthGuard)
export class NotificationsController {
    constructor(private readonly notificationsService: NotificationsService) {}

    @Get()
    @UseInterceptors(PaginationInterceptor)
    @ApiOkResponse({
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

    /**
     * Finds new notifications that have been created after last checked time. <br>
     * Returns an empty array on first connection.
     * @param session
     */
    @Get("new")
    async getNewNotifications(@Session() session: SessionContainer) {
        return this.notificationsService.findNewNotifications(
            session.getUserId(),
        );
    }

    @Put("view")
    @UseGuards(ThrottlerGuard)
    @HttpCode(HttpStatus.OK)
    async updateViewedStatus(
        @Session() session: SessionContainer,
        @Body() dto: NotificationViewUpdateDto,
    ) {
        await this.notificationsService.updateViewedStatus(
            session.getUserId(),
            dto,
        );
    }
}
