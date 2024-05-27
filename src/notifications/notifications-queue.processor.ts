import { Processor } from "@nestjs/bullmq";
import { NotificationsService } from "./notifications.service";
import { Job } from "bullmq";
import {
    NOTIFICATIONS_QUEUE_NAME,
    NOTIFICATIONS_REGISTER_JOB_NAME,
} from "./notifications.constants";
import { CreateNotificationDto } from "./dto/create-notification.dto";
import { WorkerHostProcessor } from "../utils/WorkerHostProcessor";

@Processor(NOTIFICATIONS_QUEUE_NAME)
export class NotificationsQueueProcessor extends WorkerHostProcessor {
    constructor(private readonly notificationsService: NotificationsService) {
        super();
    }

    async process(job: Job<CreateNotificationDto>) {
        if (job.name === NOTIFICATIONS_REGISTER_JOB_NAME) {
            await this.notificationsService.create(job.data);
        }
    }
}
