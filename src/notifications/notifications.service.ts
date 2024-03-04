import { Inject, Injectable, Logger, UseGuards } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, MoreThanOrEqual, Repository } from "typeorm";
import { Notification } from "./entity/notification.entity";
import { AuthGuard } from "../auth/auth.guard";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { FindNotificationsDto } from "./dto/find-notifications.dto";
import { buildBaseFindOptions } from "../utils/buildBaseFindOptions";
import { TPaginationData } from "../utils/pagination/pagination-response.dto";
import { NotificationAggregateDto } from "./dto/notification-aggregate.dto";

@Injectable()
@UseGuards(AuthGuard)
export class NotificationsService {
    private readonly logger = new Logger(NotificationsService.name);

    constructor(
        @InjectRepository(Notification)
        private notificationRepository: Repository<Notification>,
        @Inject(CACHE_MANAGER)
        private cacheManager: Cache,
    ) {}

    private getCheckedDateKey(userId: string) {
        return `${userId}-last-checked-date`;
    }

    private async getLastCheckedDate(
        userId: string,
    ): Promise<Date | undefined> {
        const dateString = await this.cacheManager.get<string>(
            this.getCheckedDateKey(userId),
        );
        if (!dateString) return undefined;
        return new Date(dateString);
    }

    private setLastCheckedDate(userId: string, date: Date) {
        return this.cacheManager.set(userId, date.toISOString());
    }

    private async findAllAfterDate(userId: string, date: Date) {
        return await this.notificationRepository.find({
            where: [
                {
                    targetProfileUserId: userId,
                    createdAt: MoreThanOrEqual(date),
                },
                {
                    targetProfileUserId: IsNull(),
                    createdAt: MoreThanOrEqual(date),
                },
            ],
        });
    }

    private aggregate(
        notifications: Notification[],
        limit: number = 10,
    ): NotificationAggregateDto[] {
        const aggregations: NotificationAggregateDto[] = [];
        const processedEntities = new Map<number, Notification>();
        for (const notification of notifications) {
            if (aggregations.length >= limit) {
                break;
            }
            if (processedEntities.has(notification.id)) {
                continue;
            }
            const similarNotifications = notifications.filter(
                (notification) => {},
            );
        }
    }

    public async findAllAndAggregate(
        userId: string,
        dto: FindNotificationsDto,
    ): Promise<TPaginationData<NotificationAggregateDto>> {
        let skippedEntities = 0;
        const [notifications, total] =
            await this.notificationRepository.findAndCount({
                skip: dto.offset || 0,
                where: [
                    {
                        targetProfileUserId: userId,
                    },
                    {
                        targetProfileUserId: IsNull(),
                    },
                ],
                order: {
                    createdAt: "DESC",
                },
            });
    }

    public async findNewNotifications(userId: string) {
        const now = new Date();
        const lastCheckedDate = await this.getLastCheckedDate(userId);
        /*
        Avoids notifying users when they first connect to the SSE.
         */
        if (!lastCheckedDate) {
            await this.setLastCheckedDate(userId, now);
            return [];
        }
        const notifications = await this.findAllAfterDate(
            userId,
            lastCheckedDate,
        );
        await this.setLastCheckedDate(userId, now);
        return notifications;
    }
}
