import { Controller, Sse, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { NotificationsService } from "./notifications.service";
import { Session } from "../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { AuthGuard } from "../auth/auth.guard";
import { interval, map } from "rxjs";

const NOTIFICATIONS_CHECK_INTERVAL = 10000;

@Controller("notifications")
@ApiTags("notifications")
@UseGuards(AuthGuard)
export class NotificationsController {
    constructor(private readonly notificationsService: NotificationsService) {}

    @Sse("stream")
    async stream(@Session() session: SessionContainer) {
        return interval(NOTIFICATIONS_CHECK_INTERVAL).pipe(
            map(() => {
                return this.notificationsService.findNewNotifications(
                    session.getUserId(),
                );
            }),
        );
    }
}
