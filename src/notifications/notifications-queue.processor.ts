import { Process, Processor } from "@nestjs/bull";
import { NotificationsService } from "./notifications.service";
import { Job } from "bull";
import {
    NOTIFICATIONS_QUEUE_NAME,
    NOTIFICATIONS_REGISTER_JOB_NAME,
} from "./notifications.constants";
import { CreateNotificationDto } from "./dto/create-notification.dto";

@Processor(NOTIFICATIONS_QUEUE_NAME)
export class NotificationsQueueProcessor {
    constructor(private readonly notificationsService: NotificationsService) {}

    @Process(NOTIFICATIONS_REGISTER_JOB_NAME)
    async process(job: Job<CreateNotificationDto>) {
        try {
            await this.notificationsService.create(job.data);
        } catch (e) {
            console.error(e);
        }
    }
}
