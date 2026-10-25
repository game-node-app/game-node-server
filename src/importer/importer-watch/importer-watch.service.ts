import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ImporterWatchNotification } from "../entity/importer-notification.entity";

@Injectable()
export class ImporterWatchService {
    constructor(
        @InjectRepository(ImporterWatchNotification)
        private readonly notifications: Repository<ImporterWatchNotification>,
    ) {}
    async findNotification(userId: string, notificationId: number) {
        const { pendingDelivery: _pendingDelivery, ...notification } =
            await this.notifications.findOneOrFail({
                where: { libraryUserId: userId, id: notificationId },
                relations: { games: true },
            });
        return notification;
    }
}
