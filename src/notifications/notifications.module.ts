import { Module } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { NotificationsController } from "./notifications.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Notification } from "./entity/notification.entity";
import { NotificationsQueueService } from "./notifications-queue.service";

@Module({
    imports: [TypeOrmModule.forFeature([Notification])],
    providers: [NotificationsService, NotificationsQueueService],
    controllers: [NotificationsController],
    exports: [NotificationsQueueService],
})
export class NotificationsModule {}
