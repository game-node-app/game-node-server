import { Module } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { NotificationsController } from "./notifications.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Notification } from "./entity/notification.entity";
import { NotificationsQueueService } from "./notifications-queue.service";
import { BullModule } from "@nestjs/bull";
import { NOTIFICATIONS_QUEUE_NAME } from "./notifications.constants";
import { NotificationsQueueProcessor } from "./notifications-queue.processor";

@Module({
    imports: [
        TypeOrmModule.forFeature([Notification]),
        BullModule.registerQueue({
            name: NOTIFICATIONS_QUEUE_NAME,
        }),
    ],
    providers: [
        NotificationsService,
        NotificationsQueueService,
        NotificationsQueueProcessor,
    ],
    controllers: [NotificationsController],
    exports: [NotificationsQueueService],
})
export class NotificationsModule {}
