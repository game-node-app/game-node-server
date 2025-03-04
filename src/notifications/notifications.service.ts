import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
    FindOptionsRelations,
    In,
    IsNull,
    MoreThanOrEqual,
    Repository,
} from "typeorm";
import { Notification } from "./entity/notification.entity";
import { Cache } from "cache-manager";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { FindNotificationsDto } from "./dto/find-notifications.dto";
import { TPaginationData } from "../utils/pagination/pagination-response.dto";
import { NotificationAggregateDto } from "./dto/notification-aggregate.dto";
import {
    ENotificationCategory,
    NotificationSourceType,
} from "./notifications.constants";
import { CreateNotificationDto } from "./dto/create-notification.dto";
import { minutes } from "@nestjs/throttler";
import { NotificationViewUpdateDto } from "./dto/notification-view-update.dto";
import { UnrecoverableError } from "bullmq";

@Injectable()
export class NotificationsService {
    private readonly logger = new Logger(NotificationsService.name);

    private readonly relations: FindOptionsRelations<Notification> = {
        profile: true,
    };

    constructor(
        @InjectRepository(Notification)
        private notificationRepository: Repository<Notification>,
        @Inject(CACHE_MANAGER)
        private cacheManager: Cache,
    ) {}

    private getCheckedDateKey(userId: string) {
        return `notification-${userId}-last-checked-date`;
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
            minutes(5),
        );
    }

    private async findAllAfterDate(userId: string, date: Date) {
        return await this.notificationRepository.find({
            where: {
                targetProfileUserId: userId,
                createdAt: MoreThanOrEqual(date),
            },

            relations: this.relations,
            order: {
                createdAt: "DESC",
            },
        });
    }

    /**
     * Creates groups of related notifications
     * @param notifications - notifications to aggregate
     * @returns Array - Array with aggregated entities. <br>
     * @private
     */
    private aggregate(
        notifications: Notification[],
    ): NotificationAggregateDto[] {
        const aggregationCategories = [
            ENotificationCategory.LIKE,
            ENotificationCategory.COMMENT,
        ];
        const aggregations: NotificationAggregateDto[] = [];
        const processedEntities = new Map<any, Notification>();

        /**
         * The logic here is:
         * Given a notification, find other ones which are similar to it (refer to the same target entity).
         * With this information, store it as 'processedEntities' to avoid re-using said notifications in
         * future iterations.
         */
        for (const notification of notifications) {
            if (processedEntities.has(notification.id)) {
                continue;
            }

            /**
             * Notifications similar to this one (including current iteration notification) that can be grouped for aggregation
             */
            const similarNotifications = notifications.filter(
                (comparedNotification) => {
                    const isAlreadyProcessed = processedEntities.has(
                        comparedNotification.id,
                    );
                    const hasValidCategory = aggregationCategories.includes(
                        comparedNotification.category,
                    );

                    const comparableSourceIds: (keyof Notification)[] = [
                        "reviewId",
                        "activityId",
                        "reviewCommentId",
                        "activityCommentId",
                    ];

                    const hasSameCategory =
                        notification.category === comparedNotification.category;
                    const hasSameSourceType =
                        notification.sourceType ===
                        comparedNotification.sourceType;

                    const hasSameSourceId = comparableSourceIds.some(
                        (property) => {
                            return (
                                comparedNotification[property] != undefined &&
                                comparedNotification[property] ===
                                    notification[property]
                            );
                        },
                    );

                    const isSimilar =
                        !isAlreadyProcessed &&
                        hasValidCategory &&
                        hasSameCategory &&
                        hasSameSourceType &&
                        hasSameSourceId;

                    if (isSimilar) {
                        processedEntities.set(
                            comparedNotification.id,
                            comparedNotification,
                        );
                    }

                    return isSimilar;
                },
            );

            // Includes current notification if the list is empty. Usually means the category can not be aggregated.
            const aggregationNotifications =
                similarNotifications.length > 0
                    ? similarNotifications
                    : [notification];

            aggregations.push({
                category: notification.category,
                // Matches any relation property that's not null
                sourceId:
                    notification.reviewId! ||
                    notification.activityId! ||
                    notification.importerNotificationId! ||
                    notification.reportId! ||
                    notification.reviewCommentId! ||
                    notification.activityCommentId! ||
                    // profileUserId should be last, otherwise you will get weird issues.
                    notification.profileUserId!,

                sourceType: notification.sourceType,
                notifications: aggregationNotifications,
            });
        }

        return aggregations;
    }

    public async findAllAndAggregate(
        userId: string,
        dto: FindNotificationsDto,
    ): Promise<TPaginationData<NotificationAggregateDto>> {
        const offset = dto.offset || 0;
        const limit = dto.limit || 20;
        const [notifications, total] =
            await this.notificationRepository.findAndCount({
                skip: offset,
                take: limit,
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
        const aggregations = this.aggregate(notifications);

        return [aggregations, total];
    }

    public async findNewNotifications(userId: string): Promise<Notification[]> {
        const now = new Date();
        const lastCheckedDate = await this.getLastCheckedDate(userId);
        /*
        Avoids notifying users when they first connect.
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

    public async create(dto: CreateNotificationDto) {
        if (
            dto.sourceId == undefined ||
            dto.sourceType == undefined ||
            dto.category == undefined
        ) {
            throw new UnrecoverableError(
                "Error while creating notification: missing sourceId or sourceType or category.",
            );
        } else if (dto.targetUserId == undefined) {
            throw new UnrecoverableError(
                "Common notifications can't be targeted at all users (targetProfileUserId is null): " +
                    JSON.stringify(dto),
            );
        } else if (dto.userId === dto.targetUserId) {
            throw new UnrecoverableError(
                `Skipping attempt to make user notify itself: ${JSON.stringify(dto)}}`,
            );
        }

        const entity = this.notificationRepository.create({
            profileUserId: dto.userId,
            targetProfileUserId: dto.targetUserId,
            sourceType: dto.sourceType,
            category: dto.category,
        });

        switch (dto.sourceType) {
            case NotificationSourceType.GAME:
                entity.gameId = dto.sourceId as number;
                break;
            case NotificationSourceType.REVIEW:
                entity.reviewId = dto.sourceId as string;
                break;
            case NotificationSourceType.ACTIVITY:
                entity.activityId = dto.sourceId as string;
                break;
            case NotificationSourceType.IMPORTER:
                entity.importerNotificationId = dto.sourceId as number;
                break;
            case NotificationSourceType.PROFILE:
                entity.profileUserId = dto.sourceId as string;
                break;
            case NotificationSourceType.REPORT:
                entity.reportId = dto.sourceId as number;
                break;
            case NotificationSourceType.ACTIVITY_COMMENT:
                entity.activityCommentId = dto.sourceId as string;
                break;
            case NotificationSourceType.REVIEW_COMMENT:
                entity.reviewCommentId = dto.sourceId as string;
                break;
            default:
                throw new UnrecoverableError(
                    `Invalid sourceType for notification: ${JSON.stringify(dto)}`,
                );
        }

        await this.notificationRepository.save(entity);
    }

    public async updateViewedStatus(
        userId: string,
        dto: NotificationViewUpdateDto,
    ) {
        await this.notificationRepository.update(
            {
                id: In(dto.notificationIds),
                targetProfileUserId: userId,
            },
            {
                isViewed: dto.isViewed,
            },
        );
    }
}
