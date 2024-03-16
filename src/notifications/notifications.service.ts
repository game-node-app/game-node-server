import { Inject, Injectable, Logger, UseGuards } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
    FindOptionsRelations,
    FindOptionsWhere,
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
    private readonly repeatedNotificationWaitPeriodHours = 1;

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

    /**
     * Creates groups of related notifications
     * @param notifications - notifications to aggregate
     * @param aggregationLimit - maximum numer of aggregated objects
     * @returns [Array, number] - Tuple with aggregated entities and number of processed notifications <br>
     * (e.g. notifications which were processed before reaching aggregationLimit) <br>
     * While similar, doesn't represent pagination data, so it shouldn't be used for that.
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
                    const isSameSource =
                        (comparedNotification.reviewId != undefined &&
                            comparedNotification.reviewId ===
                                notification.reviewId) ||
                        (comparedNotification.activityId != undefined &&
                            comparedNotification.activityId ===
                                notification.activityId);

                    const isSimilar =
                        !isAlreadyProcessed && hasValidCategory && isSameSource;

                    if (isSimilar) {
                        processedEntities.set(
                            comparedNotification.id,
                            comparedNotification,
                        );
                    }

                    return isSimilar;
                },
            );

            if (similarNotifications.length === 0) {
                aggregations.push({
                    category: notification.category,
                    sourceId:
                        notification.reviewId! ||
                        notification.activityId! ||
                        notification.profileUserId!,
                    sourceType: notification.sourceType,
                    notifications: [notification],
                });
                continue;
            }

            aggregations.push({
                category: notification.category,
                sourceId: notification.reviewId! || notification.activityId!,
                sourceType: notification.sourceType,
                notifications: similarNotifications,
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
        console.time("notifications");
        const [notifications, total] =
            await this.notificationRepository.findAndCount({
                skip: offset,
                take: limit,
                where: {
                    targetProfileUserId: userId,
                },
                order: {
                    createdAt: "DESC",
                },
                relations: this.relations,
            });
        const aggregations = this.aggregate(notifications);
        console.timeEnd("notifications");

        return [aggregations, total];
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

    private async isPossibleSpam(createDto: CreateNotificationDto) {
        const minimumRepeatedNotificationDate = new Date();
        minimumRepeatedNotificationDate.setHours(
            minimumRepeatedNotificationDate.getHours() -
                this.repeatedNotificationWaitPeriodHours,
        );
        const whereOptions: FindOptionsWhere<Notification> = {
            sourceType: createDto.sourceType,
            category: createDto.category,
            profileUserId: createDto.userId,
            targetProfileUserId: createDto.targetUserId,
            createdAt: MoreThanOrEqual(minimumRepeatedNotificationDate),
        };

        switch (createDto.sourceType) {
            case ENotificationSourceType.GAME:
                whereOptions.gameId = createDto.sourceId as number;
                break;
            case ENotificationSourceType.REVIEW:
                whereOptions.reviewId = createDto.sourceId as string;
                break;
            case ENotificationSourceType.ACTIVITY:
                whereOptions.activityId = createDto.sourceId as string;
                break;
        }

        return await this.notificationRepository.exist({
            where: whereOptions,
        });
    }

    public async create(dto: CreateNotificationDto) {
        if (dto.sourceId == undefined) {
            throw new Error(
                "Error while creating a new notification: missing sourceId.",
            );
        } else if (
            dto.targetUserId != undefined &&
            dto.userId === dto.targetUserId
        ) {
            this.logger.warn(
                `Skipping attempt to make user notify itself: ${dto.userId} -> ${dto.targetUserId}`,
            );
            return;
        } else if (await this.isPossibleSpam(dto)) {
            this.logger.warn(
                `Skipping attempt to create repeated notification: ${JSON.stringify(
                    dto,
                )}`,
            );
            return;
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
