import { Injectable } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { CreateNotificationDto } from "./dto/create-notification.dto";
import { InjectQueue } from "@nestjs/bull";

@Injectable()
export class NotificationsQueueService {
    constructor(@InjectQueue()) {}

    async registerNotification(dto: CreateNotificationDto){

    }
}
