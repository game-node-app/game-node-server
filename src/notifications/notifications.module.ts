import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsQueueService } from './notifications-queue.service';
import { NotificationsController } from './notifications.controller';

@Module({
  providers: [NotificationsService, NotificationsQueueService],
  controllers: [NotificationsController]
})
export class NotificationsModule {}
