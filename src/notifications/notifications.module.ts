import { Module } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { NotificationsController } from "./notifications.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { NotificationOutbox } from "./entity/notification-outbox.entity";
import { NotificationEvent } from "./entity/notification-event.entity";
import { NotificationInbox } from "./entity/notification-inbox.entity";
import { NotificationCampaign } from "./entity/notification-campaign.entity";
import { Profile } from "../profile/entities/profile.entity";
import { NotificationsOutboxService } from "./notifications-outbox.service";
import { NotificationsRelayService } from "./notifications-relay.service";
import { NotificationsProjectorService } from "./notifications-projector.service";
import { NotificationsLifecycleService } from "./notifications-lifecycle.service";
import { NotificationCampaignService } from "./notification-campaign.service";
import { BullModule } from "@nestjs/bullmq";
import { NOTIFICATIONS_QUEUE_NAME } from "./notifications.constants";
import { NotificationsQueueProcessor } from "./notifications-queue.processor";
import { LibrariesModule } from "../libraries/libraries.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([
            NotificationOutbox,
            NotificationEvent,
            NotificationInbox,
            NotificationCampaign,
            Profile,
        ]),
        BullModule.registerQueue({
            name: NOTIFICATIONS_QUEUE_NAME,
        }),
        LibrariesModule,
    ],
    providers: [
        NotificationsService,
        NotificationsQueueProcessor,
        NotificationsOutboxService,
        NotificationsRelayService,
        NotificationsProjectorService,
        NotificationsLifecycleService,
        NotificationCampaignService,
    ],
    controllers: [NotificationsController],
    exports: [
        NotificationsOutboxService,
        NotificationsRelayService,
        NotificationsProjectorService,
        NotificationsLifecycleService,
        NotificationCampaignService,
    ],
})
export class NotificationsModule {}
