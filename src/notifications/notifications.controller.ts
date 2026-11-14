import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Patch,
    Query,
    UseGuards,
} from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { NotificationsService } from "./notifications.service";
import { Session, SessionContainer } from "../auth/session.decorator";
import { AuthGuard } from "../auth/auth.guard";
import { FindNotificationsDto } from "./dto/find-notifications.dto";
import {
    NotificationReadAllRequestDto,
    NotificationReadAllResponseDto,
} from "./dto/notification-read-all.dto";
import { NotificationReadRequestDto } from "./dto/notification-read.dto";
import { NotificationsResponseDto } from "./dto/notifications-response.dto";

@Controller("notifications")
@ApiTags("notifications")
@UseGuards(AuthGuard)
export class NotificationsController {
    constructor(private readonly notificationsService: NotificationsService) {}

    @Get()
    @ApiOkResponse({
        type: NotificationsResponseDto,
    })
    async findAll(
        @Session() session: SessionContainer,
        @Query() dto: FindNotificationsDto,
    ): Promise<NotificationsResponseDto> {
        return this.notificationsService.findAll(session.getUserId(), dto);
    }

    @Patch("read")
    @HttpCode(HttpStatus.OK)
    async acknowledgeRead(
        @Session() session: SessionContainer,
        @Body() dto: NotificationReadRequestDto,
    ): Promise<{ success: boolean }> {
        return this.notificationsService.acknowledgeRead(
            session.getUserId(),
            dto,
        );
    }

    @Patch("read-all")
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({
        type: NotificationReadAllResponseDto,
    })
    async acknowledgeReadAll(
        @Session() session: SessionContainer,
        @Body() dto: NotificationReadAllRequestDto = {},
    ): Promise<NotificationReadAllResponseDto> {
        return this.notificationsService.acknowledgeReadAll(
            session.getUserId(),
            dto?.before,
        );
    }
}
