import { Injectable, Logger } from "@nestjs/common";
import { CreateNotificationDto } from "./dto/create-notification.dto";
import { InjectQueue } from "@nestjs/bull";
import { Queue } from "bull";
import {
    NOTIFICATIONS_QUEUE_NAME,
    NOTIFICATIONS_REGISTER_JOB_NAME,
} from "./notifications.constants";

@Injectable()
export class NotificationsQueueService {
    private readonly logger = new Logger(NotificationsQueueService.name);
    constructor(
        @InjectQueue(NOTIFICATIONS_QUEUE_NAME)
        private readonly queue: Queue,
    ) {}

    public registerNotification(dto: CreateNotificationDto) {
        this.queue
            .add(NOTIFICATIONS_REGISTER_JOB_NAME, dto)
            .then()
            .catch((err) => {
                this.logger.error(err);
            });
    }
}
