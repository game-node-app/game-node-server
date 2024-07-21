import { Module } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { NotificationsController } from "./notifications.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Notification } from "./entity/notification.entity";
import { NotificationsQueueService } from "./notifications-queue.service";
import { BullModule } from "@nestjs/bullmq";
import { NOTIFICATIONS_QUEUE_NAME } from "./notifications.constants";
import { NotificationsQueueProcessor } from "./notifications-queue.processor";
import { BullBoardModule } from "@bull-board/nestjs";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";

@Module({
    imports: [
        TypeOrmModule.forFeature([Notification]),
        BullModule.registerQueue({
            name: NOTIFICATIONS_QUEUE_NAME,
        }),
        BullBoardModule.forFeature({
            name: NOTIFICATIONS_QUEUE_NAME,
            adapter: BullMQAdapter,
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
