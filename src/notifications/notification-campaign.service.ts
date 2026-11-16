import { Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { appendNotificationIntent } from "./notifications-outbox.service";
import {
    AWARDS_MILESTONES,
    AwardsMilestonePayload,
    NotificationEventIntent,
    SUPPORTED_EVENT_VERSION,
} from "./notifications.types";

export const NOTIFICATION_CAMPAIGN_BATCH_SIZE = 1000;
export const NOTIFICATION_CAMPAIGN_MAX_BATCHES_PER_TICK = 20;

export type NotificationCampaignRequest =
    | {
          key: string;
          eventType: "awards.milestone";
          payload: AwardsMilestonePayload;
      }
    | {
          key: string;
          eventType: "goal.reminder";
          payload: { year: number };
      };

export interface NotificationCampaignOptions {
    batchSize?: number;
    maxBatches?: number;
}

export interface NotificationCampaignProgress {
    completed: boolean;
    sent: number;
    /** Batches consumed by this call, so a tick can share one budget across campaigns. */
    batches: number;
}

interface CampaignRecipient {
    userId: string;
    target?: number | string;
    finished?: number | string;
}

interface CampaignRow {
    eventType: string;
    payload: Record<string, any> | string;
    cursorUserId: string | null;
    completedAt: Date | string | null;
}

// Same rule as AuthService.getLockoutStates: an expired suspension is not a lockout.
// COALESCE covers user rows whose banned flag was never written.
const ACTIVE_LOCKOUT_SQL = `(COALESCE(u.banned, 0) = 1 AND (u.banExpires IS NULL OR u.banExpires > CURRENT_TIMESTAMP(3)))`;

/**
 * Bounded, resumable fan-out for notifications sent to many users (design 8).
 * Callers own the campaign key and payload; this service owns batching, the
 * cursor, the recipient filters and the one-intent-per-recipient guarantee.
 */
@Injectable()
export class NotificationCampaignService {
    constructor(private readonly dataSource: DataSource) {}

    /**
     * Run at most `maxBatches` batches for this campaign. Calling it again
     * continues from the stored cursor; a completed campaign sends nothing.
     */
    async runCampaign(
        request: NotificationCampaignRequest,
        options: NotificationCampaignOptions = {},
    ): Promise<NotificationCampaignProgress> {
        const key = request.key?.trim();
        if (!key || key.length > 255) {
            throw new RangeError("Invalid notification campaign key");
        }
        this.assertPayload(request);

        const batchSize = options.batchSize ?? NOTIFICATION_CAMPAIGN_BATCH_SIZE;
        if (
            !Number.isInteger(batchSize) ||
            batchSize < 1 ||
            batchSize > NOTIFICATION_CAMPAIGN_BATCH_SIZE
        ) {
            throw new RangeError("Invalid notification campaign batch size");
        }
        const maxBatches =
            options.maxBatches ?? NOTIFICATION_CAMPAIGN_MAX_BATCHES_PER_TICK;
        if (
            !Number.isInteger(maxBatches) ||
            maxBatches < 1 ||
            maxBatches > NOTIFICATION_CAMPAIGN_MAX_BATCHES_PER_TICK
        ) {
            throw new RangeError("Invalid notification campaign batch budget");
        }

        await this.dataSource.query(
            "INSERT IGNORE INTO notification_campaign (`key`, eventType, payload, createdAt) VALUES (?, ?, ?, CURRENT_TIMESTAMP(6))",
            [key, request.eventType, JSON.stringify(request.payload)],
        );

        let sent = 0;
        for (let batch = 0; batch < maxBatches; batch++) {
            const progress = await this.processBatch(key, batchSize);
            sent += progress.count;
            if (progress.completed) {
                return { completed: true, sent, batches: batch + 1 };
            }
        }
        return { completed: false, sent, batches: maxBatches };
    }

    private assertPayload(request: NotificationCampaignRequest): void {
        if (request.eventType === "awards.milestone") {
            const { eventId, year, milestone } = request.payload;
            if (
                !Number.isSafeInteger(eventId) ||
                eventId < 1 ||
                !Number.isSafeInteger(year) ||
                year < 1 ||
                !AWARDS_MILESTONES.includes(milestone)
            ) {
                throw new RangeError("Invalid awards milestone campaign");
            }
            return;
        }
        if (
            !Number.isSafeInteger(request.payload.year) ||
            request.payload.year < 1
        ) {
            throw new RangeError("Invalid goal reminder campaign");
        }
    }

    private processBatch(
        key: string,
        batchSize: number,
    ): Promise<{ count: number; completed: boolean }> {
        return this.dataSource.transaction(async (manager) => {
            const [campaign] = (await manager.query(
                "SELECT eventType, payload, cursorUserId, completedAt FROM notification_campaign WHERE `key` = ? FOR UPDATE",
                [key],
            )) as CampaignRow[];
            if (!campaign) {
                throw new Error("Notification campaign row is missing");
            }
            if (campaign.completedAt) return { count: 0, completed: true };

            const payload =
                typeof campaign.payload === "string"
                    ? JSON.parse(campaign.payload)
                    : campaign.payload;
            const cursor = campaign.cursorUserId ?? null;
            const recipients = await this.selectRecipients(
                manager,
                campaign.eventType,
                payload,
                cursor,
                batchSize,
            );

            if (recipients.length === 0) {
                await manager.query(
                    "UPDATE notification_campaign SET completedAt = CURRENT_TIMESTAMP(3) WHERE `key` = ?",
                    [key],
                );
                return { count: 0, completed: true };
            }

            for (const recipient of recipients) {
                await appendNotificationIntent(
                    manager,
                    this.buildIntent(campaign.eventType, payload, recipient),
                );
            }
            await manager.query(
                "UPDATE notification_campaign SET cursorUserId = ? WHERE `key` = ?",
                [recipients[recipients.length - 1].userId, key],
            );
            return { count: recipients.length, completed: false };
        });
    }

    private selectRecipients(
        manager: EntityManager,
        eventType: string,
        payload: Record<string, any>,
        cursor: string | null,
        batchSize: number,
    ): Promise<CampaignRecipient[]> {
        if (eventType === "awards.milestone") {
            return this.selectAwardsRecipients(
                manager,
                payload as AwardsMilestonePayload,
                cursor,
                batchSize,
            );
        }
        if (eventType === "goal.reminder") {
            return this.selectGoalRecipients(
                manager,
                payload,
                cursor,
                batchSize,
            );
        }
        throw new Error(`Unsupported campaign event type: ${eventType}`);
    }

    private async selectAwardsRecipients(
        manager: EntityManager,
        payload: AwardsMilestonePayload,
        cursor: string | null,
        batchSize: number,
    ): Promise<CampaignRecipient[]> {
        const base = `SELECT p.userId AS userId FROM profile p
            JOIN \`user\` u ON u.id = p.userId
            WHERE p.userId > ? AND NOT ${ACTIVE_LOCKOUT_SQL}`;
        const order = "ORDER BY p.userId ASC LIMIT ?";
        const from = cursor ?? "";

        if (payload.milestone === "nominations_close_reminder") {
            return manager.query(
                `${base}
                AND NOT EXISTS (
                    SELECT 1 FROM awards_nomination n
                    JOIN awards_category c ON c.id = n.categoryId
                    WHERE n.profileUserId = p.userId AND c.eventId = ?
                )
                ${order}`,
                [from, payload.eventId, batchSize],
            );
        }

        if (payload.milestone === "voting_close_reminder") {
            return manager.query(
                `${base}
                AND EXISTS (SELECT 1 FROM awards_category c WHERE c.eventId = ?)
                AND (
                    SELECT COUNT(DISTINCT v.categoryId) FROM awards_vote v
                    JOIN awards_category c ON c.id = v.categoryId
                    WHERE v.profileUserId = p.userId AND c.eventId = ?
                ) < (SELECT COUNT(*) FROM awards_category c WHERE c.eventId = ?)
                ${order}`,
                [
                    from,
                    payload.eventId,
                    payload.eventId,
                    payload.eventId,
                    batchSize,
                ],
            );
        }

        return manager.query(`${base} ${order}`, [from, batchSize]);
    }

    private async selectGoalRecipients(
        manager: EntityManager,
        payload: Record<string, any>,
        cursor: string | null,
        batchSize: number,
    ): Promise<CampaignRecipient[]> {
        const year = Number(payload.year);
        const yearStart = new Date(Date.UTC(year, 0, 1));
        const yearEnd = new Date(Date.UTC(year + 1, 0, 1));
        return manager.query(
            `SELECT p.userId AS userId, g.finishedGamesTarget AS target,
                (SELECT COUNT(*) FROM collection_entry ce
                 WHERE ce.libraryUserId = p.userId
                   AND ce.finishedAt >= ? AND ce.finishedAt < ?) AS finished
             FROM profile p
             JOIN \`user\` u ON u.id = p.userId
             JOIN year_goal g ON g.profileUserId = p.userId AND g.year = ?
             WHERE p.userId > ? AND NOT ${ACTIVE_LOCKOUT_SQL}
             ORDER BY p.userId ASC LIMIT ?`,
            [yearStart, yearEnd, year, cursor ?? "", batchSize],
        );
    }

    private buildIntent(
        eventType: string,
        payload: Record<string, any>,
        recipient: CampaignRecipient,
    ): NotificationEventIntent {
        if (eventType === "awards.milestone") {
            return {
                eventType: "awards.milestone",
                eventVersion: SUPPORTED_EVENT_VERSION,
                recipientUserId: recipient.userId,
                actorUserId: null, // system notifications have no actor
                payload: payload as AwardsMilestonePayload,
            };
        }
        return {
            eventType: "goal.reminder",
            eventVersion: SUPPORTED_EVENT_VERSION,
            recipientUserId: recipient.userId,
            actorUserId: null,
            payload: {
                year: Number(payload.year),
                target: Number(recipient.target),
                finished: Number(recipient.finished),
            },
        };
    }
}
