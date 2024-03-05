import {
    HttpException,
    HttpStatus,
    Inject,
    Injectable,
    Logger,
    UseGuards,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
    FindOptionsRelations,
    IsNull,
    MoreThanOrEqual,
    Repository,
} from "typeorm";
import { Notification } from "./entity/notification.entity";
import { AuthGuard } from "../auth/auth.guard";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { FindNotificationsDto } from "./dto/find-notifications.dto";
import { TPaginationData } from "../utils/pagination/pagination-response.dto";
import { NotificationAggregateDto } from "./dto/notification-aggregate.dto";
import {
    ENotificationCategory,
    ENotificationSourceType,
} from "./notifications.constants";
import { CreateNotificationDto } from "./dto/create-notification.dto";
import { MessageEvent } from "@nestjs/common";

@Injectable()
@UseGuards(AuthGuard)
export class NotificationsService {
    private readonly logger = new Logger(NotificationsService.name);

    private readonly relations: FindOptionsRelations<Notification> = {
        profile: true,
        targetProfile: true,
    };

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
        return this.cacheManager.set(
            this.getCheckedDateKey(userId),
            date.toISOString(),
        );
    }

    private async findAllAfterDate(userId: string, date: Date) {
        return await this.notificationRepository.find({
            where: [
                {
                    targetProfileUserId: userId,
                    createdAt: MoreThanOrEqual(date),
                },
            ],
            relations: this.relations,
            order: {
                createdAt: "DESC",
            },
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
        const processedEntities = new Map<any, Notification>();

        for (const notification of notifications) {
            if (
                notification.reviewId == undefined &&
                notification.activityId == undefined
            ) {
                continue;
            }

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
                        comparedNotification.id === notification.id;

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
                console.log(allNotifications, similarNotifications);

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
                relations: this.relations,
            });
        return [this.aggregate(notifications), total];
    }

    public async findNewNotifications(
        userId: string,
        isInitialConnection: boolean,
    ): Promise<MessageEvent> {
        const now = new Date();
        const lastCheckedDate = await this.getLastCheckedDate(userId);
        /*
        Avoids notifying users when they first connect to the SSE.
         */
        if (!lastCheckedDate || isInitialConnection) {
            await this.setLastCheckedDate(userId, now);
            return {
                data: JSON.stringify([]),
            };
        }
        const notifications = await this.findAllAfterDate(
            userId,
            lastCheckedDate,
        );
        await this.setLastCheckedDate(userId, now);
        return {
            data: JSON.stringify(notifications),
        };
    }

    public async create(dto: CreateNotificationDto) {
        if (dto.sourceId == undefined) {
            throw new Error(
                "Error while creating a new notification: invalid parameters.",
            );
        }
        const entity = this.notificationRepository.create({
            profileUserId: dto.userId,
            targetProfileUserId: dto.targetUserId,
            sourceType: dto.sourceType,
            category: dto.category,
        });
        switch (dto.sourceType) {
            case ENotificationSourceType.GAME:
                entity.gameId = dto.sourceId as number;
                entity.targetProfileUserId = dto.userId;
                break;
            case ENotificationSourceType.REVIEW:
                entity.reviewId = dto.sourceId as string;
                break;
            case ENotificationSourceType.ACTIVITY:
                entity.activityId = dto.sourceId as string;
                break;
        }

        if (entity.targetProfileUserId == undefined) {
            throw new Error(
                "Common notifications can't be targeted at all users (targetProfile is null): " +
                    JSON.stringify(dto),
            );
        }

        await this.notificationRepository.save(entity);
    }

    public async updateViewedStatus(
        userId: string,
        notificationId: number,
        isViewed: boolean,
    ) {
        return this.notificationRepository.update(notificationId, {
            isViewed,
            targetProfileUserId: userId,
        });
    }
}
