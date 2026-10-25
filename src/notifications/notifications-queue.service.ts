import { Injectable, Logger } from "@nestjs/common";
import { CreateNotificationDto } from "./dto/create-notification.dto";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
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

    public registerImporterNotification(dto: CreateNotificationDto) {
        return this.queue.add(NOTIFICATIONS_REGISTER_JOB_NAME, dto, {
            jobId: `importer-notification-${dto.sourceId}`,
            removeOnComplete: { age: 3600, count: 1000 },
            removeOnFail: { age: 604800, count: 1000 },
        });
    }

    public registerNotification(dto: CreateNotificationDto) {
        this.queue
            .add(NOTIFICATIONS_REGISTER_JOB_NAME, dto)
            .then()
            .catch((err) => {
                this.logger.error(err);
            });
    }
}
