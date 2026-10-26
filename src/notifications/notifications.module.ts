import { Module } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { NotificationsController } from "./notifications.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { NotificationOutbox } from "./entity/notification-outbox.entity";
import { NotificationEvent } from "./entity/notification-event.entity";
import { NotificationInbox } from "./entity/notification-inbox.entity";
import { Profile } from "../profile/entities/profile.entity";
import { NotificationsOutboxService } from "./notifications-outbox.service";
import { NotificationsRelayService } from "./notifications-relay.service";
import { NotificationsProjectorService } from "./notifications-projector.service";
import { NotificationsLifecycleService } from "./notifications-lifecycle.service";
import { BullModule } from "@nestjs/bullmq";
import { NOTIFICATIONS_QUEUE_NAME } from "./notifications.constants";
import { NotificationsQueueProcessor } from "./notifications-queue.processor";

@Module({
    imports: [
        TypeOrmModule.forFeature([
            NotificationOutbox,
            NotificationEvent,
            NotificationInbox,
            Profile,
        ]),
        BullModule.registerQueue({
            name: NOTIFICATIONS_QUEUE_NAME,
        }),
    ],
    providers: [
        NotificationsService,
        NotificationsQueueProcessor,
        NotificationsOutboxService,
        NotificationsRelayService,
        NotificationsProjectorService,
        NotificationsLifecycleService,
    ],
    controllers: [NotificationsController],
    exports: [
        NotificationsOutboxService,
        NotificationsRelayService,
        NotificationsProjectorService,
        NotificationsLifecycleService,
    ],
})
export class NotificationsModule {}
