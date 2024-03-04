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
import { ENotificationCategory } from "./notifications.constants";

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
        aggregatedLimit: number = 10,
    ): NotificationAggregateDto[] {
        const aggregationCategories = [
            ENotificationCategory.LIKE,
            ENotificationCategory.COMMENT,
        ];
        const aggregations: NotificationAggregateDto[] = [];
        const processedEntities = new Map<number, Notification>();

        for (const notification of notifications) {
            if (
                notification.reviewId == undefined &&
                notification.activityId == undefined
            ) {
                continue;
            }
            console.log(notification.id);
            console.log(
                notification.id,
                ...processedEntities.keys(),
                processedEntities.get(notification.id),
                processedEntities.has(notification.id),
            );
            if (processedEntities.has(notification.id)) {
                console.log("Skipped " + notification.id);
                continue;
            }
            if (aggregations.length >= aggregatedLimit) {
                break;
            }

            const similarNotifications = notifications.filter(
                (comparedNotification) => {
                    const hasSameId =
                        comparedNotification.id !== notification.id;
                    const isAlreadyProcessed = processedEntities.has(
                        comparedNotification.id,
                    );
                    const hasValidCategory = aggregationCategories.includes(
                        comparedNotification.category,
                    );
                    const isSameSource =
                        (comparedNotification.reviewId != undefined &&
                            comparedNotification.reviewId ===
                                notification.reviewId) ||
                        (comparedNotification.activityId != undefined &&
                            comparedNotification.activityId ===
                                notification.activityId);

                    return (
                        !hasSameId &&
                        !isAlreadyProcessed &&
                        hasValidCategory &&
                        isSameSource
                    );
                },
            );

            if (similarNotifications.length > 0) {
                const allNotifications = [
                    notification,
                    ...similarNotifications,
                ];
                allNotifications.forEach((notif) => {
                    processedEntities.set(notif.id, notif);
                });

                aggregations.push({
                    category: notification.category,
                    sourceId:
                        notification.reviewId! || notification.activityId!,
                    notifications: allNotifications,
                });
            } else {
                processedEntities.set(notification.id, notification);
                aggregations.push({
                    category: notification.category,
                    sourceId:
                        notification.reviewId! || notification.activityId!,
                    notifications: [notification],
                });
            }
        }

        return aggregations;
    }

    public async findAllAndAggregate(
        userId: string,
        dto: FindNotificationsDto,
    ): Promise<TPaginationData<NotificationAggregateDto>> {
        const offset = dto.offset || 0;
        const safeFindLimit = offset + 100;
        const [notifications, total] =
            await this.notificationRepository.findAndCount({
                skip: offset,
                take: safeFindLimit,
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
        return [this.aggregate(notifications), total];
    }

    public async findNewNotifications(
        userId: string,
        isInitialConnection: boolean,
    ) {
        const now = new Date();
        const lastCheckedDate = await this.getLastCheckedDate(userId);
        /*
        Avoids notifying users when they first connect to the SSE.
         */
        if (!lastCheckedDate || isInitialConnection) {
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
