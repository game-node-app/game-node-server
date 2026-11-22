import { Injectable, Logger } from "@nestjs/common";
import { DataSource } from "typeorm";
import { appendNotificationIntent } from "../notifications/notifications-outbox.service";
import { DAY_MS, GuildContractStatus } from "./guild.constants";

interface ReminderCandidate {
    id: string;
    profileUserId: string;
    category: string;
    templateKey: string | null;
    eventId: string | null;
    targetGameId: string | null;
    status: GuildContractStatus;
    expiresAt: Date | null;
    expiringNotifiedAt: Date | null;
}

/** Queues the 24h deadline reminder at most once per active contract (design 18). */
@Injectable()
export class GuildContractRemindersService {
    private readonly logger = new Logger(GuildContractRemindersService.name);

    constructor(private readonly dataSource: DataSource) {}

    public async notifyExpiring(now = new Date()): Promise<number> {
        // shortcut: at most 500 reminders per hourly tick; upgrade to paging if more than 500 contracts can share a 24h deadline window.
        const candidates: ReminderCandidate[] = await this.dataSource.query(
            `SELECT id, profileUserId, category, templateKey, eventId, targetGameId, status, expiresAt, expiringNotifiedAt
             FROM guild_contract
             WHERE status = ? AND expiresAt > ? AND expiresAt <= ? AND expiringNotifiedAt IS NULL
             ORDER BY expiresAt ASC
             LIMIT 500`,
            [GuildContractStatus.ACTIVE, now, new Date(now.getTime() + DAY_MS)],
        );

        let notified = 0;
        for (const candidate of candidates) {
            try {
                if (await this.notifyContract(candidate.id, now)) notified++;
            } catch (error) {
                this.logger.error(
                    `Guild contract expiry reminder failed for ${
                        candidate.id
                    }: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }
        }
        return notified;
    }

    private async notifyContract(
        contractId: string,
        now: Date,
    ): Promise<boolean> {
        return this.dataSource.transaction(async (manager) => {
            const rows: ReminderCandidate[] = await manager.query(
                `SELECT id, profileUserId, category, templateKey, eventId, targetGameId, status, expiresAt, expiringNotifiedAt
                 FROM guild_contract WHERE id = ? FOR UPDATE`,
                [contractId],
            );
            const contract = rows[0];
            if (
                !contract ||
                contract.status !== GuildContractStatus.ACTIVE ||
                contract.expiringNotifiedAt !== null ||
                !contract.expiresAt
            )
                return false;

            const expiresAt = new Date(contract.expiresAt);
            if (
                expiresAt <= now ||
                expiresAt > new Date(now.getTime() + DAY_MS)
            )
                return false;

            const result = await manager.query(
                `UPDATE guild_contract SET expiringNotifiedAt = ?
                 WHERE id = ? AND status = ? AND expiringNotifiedAt IS NULL`,
                [now, contractId, GuildContractStatus.ACTIVE],
            );
            if (Number(result.affectedRows) !== 1) return false;

            await appendNotificationIntent(manager, {
                eventType: "guild.contract-expiring",
                eventVersion: 1,
                occurredAt: now,
                recipientUserId: contract.profileUserId,
                actorUserId: null,
                payload: {
                    contractId,
                    category: contract.category,
                    templateKey: contract.templateKey ?? null,
                    eventId: contract.eventId ?? null,
                    targetGameId:
                        contract.targetGameId === null
                            ? null
                            : Number(contract.targetGameId),
                    expiresAt: expiresAt.toISOString(),
                },
            });
            return true;
        });
    }
}
