import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, Repository } from "typeorm";
import { NOTIFICATION_ELIGIBILITY_SQL } from "./notifications-lifecycle.service";
import { NotificationTarget } from "./notifications.types";
import { NotificationInbox } from "./entity/notification-inbox.entity";
import { Profile } from "../profile/entities/profile.entity";
import { FindNotificationsDto } from "./dto/find-notifications.dto";
import { NotificationReadRequestDto } from "./dto/notification-read.dto";
import {
    NotificationActorDto,
    NotificationInboxItemDto,
    NotificationsResponseDto,
} from "./dto/notifications-response.dto";
import {
    decodeNotificationCursor,
    encodeNotificationCursor,
} from "./notifications.utils";

@Injectable()
export class NotificationsService {
    private readonly logger = new Logger(NotificationsService.name);
    constructor(
        @InjectRepository(NotificationInbox)
        private notificationInboxRepository: Repository<NotificationInbox>,
        @InjectRepository(Profile)
        private profileRepository: Repository<Profile>,
        private dataSource: DataSource,
    ) {}

    public async findAll(
        userId: string,
        dto: FindNotificationsDto,
    ): Promise<NotificationsResponseDto> {
        const startedAt = Date.now();
        const limit = dto.limit ?? 20;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
            throw new BadRequestException("Invalid notification limit");
        }
        let cursorData: { lastEventAt: Date; id: number } | null = null;
        if (dto.cursor) {
            cursorData = decodeNotificationCursor(dto.cursor, userId);
        }

        const pageItems: NotificationInbox[] = [];
        let scanned = 0;
        let hasMore = false;
        // Bound refill to five pages of candidates, including inaccessible groups.
        const scanBudget = limit * 5;
        while (pageItems.length < limit && scanned < scanBudget) {
            const batchSize = Math.min(limit, scanBudget - scanned);
            const qb = this.notificationInboxRepository
                .createQueryBuilder("inbox")
                .where("inbox.recipientUserId = :userId", { userId })
                .andWhere("inbox.isVisible = :isVisible", { isVisible: true });
            if (cursorData) {
                qb.andWhere(
                    "(inbox.lastEventAt < :cursorTime OR (inbox.lastEventAt = :cursorTime AND inbox.id < :cursorId))",
                    {
                        cursorTime: cursorData.lastEventAt,
                        cursorId: cursorData.id,
                    },
                );
            }
            const candidates = await qb
                .orderBy("inbox.lastEventAt", "DESC")
                .addOrderBy("inbox.id", "DESC")
                .take(batchSize + 1)
                .getMany();
            const eligible = new Set(
                (
                    await this.filterEligibleCandidates(
                        candidates.slice(0, batchSize),
                    )
                ).map((item) => item.id),
            );
            let consumed = 0;
            for (const item of candidates.slice(0, batchSize)) {
                scanned++;
                consumed++;
                cursorData = { lastEventAt: item.lastEventAt, id: item.id };
                if (eligible.has(item.id)) pageItems.push(item);
                if (pageItems.length === limit) break;
            }
            hasMore = candidates.length > consumed;
            if (!hasMore) break;
        }
        const nextCursor =
            hasMore && cursorData
                ? encodeNotificationCursor(
                      userId,
                      cursorData.lastEventAt,
                      cursorData.id,
                  )
                : null;

        const allActorIds = Array.from(
            new Set(pageItems.flatMap((i) => i.actorIds || [])),
        ).filter(Boolean);

        const profileMap = new Map<string, NotificationActorDto>();
        if (allActorIds.length > 0) {
            const profiles = await this.profileRepository.find({
                where: { userId: In(allActorIds) },
                select: {
                    userId: true,
                    username: true,
                    avatar: { id: true, filename: true },
                },
                relations: { avatar: true },
            });
            for (const p of profiles) {
                profileMap.set(p.userId, {
                    userId: p.userId,
                    username: p.username,
                    avatar: p.avatar
                        ? { id: p.avatar.id, filename: p.avatar.filename }
                        : null,
                });
            }
        }

        const data: NotificationInboxItemDto[] = pageItems.map((item) => ({
            id: item.id,
            type: item.type,
            actors: (item.actorIds || []).map(
                (actorId) =>
                    profileMap.get(actorId) || {
                        userId: actorId,
                        username: "[Deleted User]",
                        avatar: null,
                    },
            ),
            preview: item.preview,
            target: item.target as NotificationTarget | null,
            eventCount: item.eventCount,
            actorCount: item.actorCount,
            lastEventAt: item.lastEventAt,
            version: item.version,
            readVersion: item.readVersion,
        }));

        const unreadCount = await this.notificationInboxRepository
            .createQueryBuilder("inbox")
            .where("inbox.recipientUserId = :userId", { userId })
            .andWhere("inbox.isVisible = :isVisible", { isVisible: true })
            .andWhere("inbox.readVersion < inbox.version")
            .andWhere(NOTIFICATION_ELIGIBILITY_SQL)
            .getCount();

        this.logger.debug({
            event: "notification-inbox-read",
            durationMs: Date.now() - startedAt,
            returnedCount: data.length,
            scannedCount: scanned,
            limit,
        });
        return {
            data,
            pagination: {
                nextCursor,
                hasMore,
            },
            unreadCount,
        };
    }

    private async filterEligibleCandidates(
        candidates: NotificationInbox[],
    ): Promise<NotificationInbox[]> {
        if (candidates.length === 0) return [];
        const recipientUserId = candidates[0].recipientUserId;
        const rows: Array<{ id: number }> = await this.dataSource.query(
            `SELECT inbox.id FROM notification_inbox inbox WHERE inbox.recipientUserId = ? AND inbox.id IN (?) AND (${NOTIFICATION_ELIGIBILITY_SQL})`,
            [recipientUserId, candidates.map((item) => item.id)],
        );
        const eligible = new Set(rows.map((row) => row.id));
        return candidates.filter((item) => eligible.has(item.id));
    }

    public async acknowledgeRead(
        userId: string,
        dto: NotificationReadRequestDto,
    ): Promise<{ success: boolean }> {
        const itemIds = dto.items.map((i) => i.id);
        const uniqueItemIds = Array.from(new Set(itemIds));

        const inboxes = await this.notificationInboxRepository.find({
            where: {
                id: In(uniqueItemIds),
                recipientUserId: userId,
            },
        });

        if (inboxes.length !== uniqueItemIds.length) {
            throw new BadRequestException(
                "One or more notification items do not exist or belong to another recipient",
            );
        }

        const inboxMap = new Map(inboxes.map((i) => [i.id, i]));
        for (const item of dto.items) {
            const inbox = inboxMap.get(item.id)!;
            if (item.version > inbox.version) {
                throw new BadRequestException(
                    `Acknowledged version ${item.version} exceeds current item version ${inbox.version} for item ${item.id}`,
                );
            }
        }

        for (const item of dto.items) {
            await this.notificationInboxRepository
                .createQueryBuilder()
                .update(NotificationInbox)
                .set({
                    readVersion: () =>
                        `GREATEST(readVersion, ${Number(item.version)})`,
                })
                .where("id = :id AND recipientUserId = :userId", {
                    id: item.id,
                    userId,
                })
                .execute();
        }

        return { success: true };
    }
}
