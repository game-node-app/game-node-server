import { Injectable, Logger } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { appendNotificationIntent } from "../notifications/notifications-outbox.service";
import { PlaytimeHistoryService } from "../playtime/playtime-history.service";
import { GuildContract } from "./entities/guild-contract.entity";
import { GuildContractStatus } from "./guild.constants";
import {
    GuildEvaluationContext,
    GuildObjectiveEvaluation,
    evaluateGuildBonusObjective,
    evaluateGuildObjective,
} from "./evaluators";
import { GuildTimeToBeatService } from "./guild-time-to-beat.service";

/**
 * Evaluates accepted contracts against facts committed after `acceptedAt`,
 * moving them to `ready_to_claim` exactly once (design 5).
 */
@Injectable()
export class GuildContractEvaluatorService {
    private readonly logger = new Logger(GuildContractEvaluatorService.name);

    constructor(
        private readonly dataSource: DataSource,
        private readonly guildTimeToBeatService: GuildTimeToBeatService,
        private readonly playtimeHistoryService: PlaytimeHistoryService,
    ) {}

    /** Lazily expires overdue `active` contracts; ready/completed rows never expire. */
    public async expireOverdueContracts(
        userId?: string,
        now = new Date(),
    ): Promise<number> {
        return this.expireOverdueWithManager(
            this.dataSource.manager,
            userId,
            now,
        );
    }

    public async expireOverdueWithManager(
        manager: EntityManager,
        userId: string | undefined,
        now: Date,
    ): Promise<number> {
        const conditions = [
            "status = ?",
            "expiresAt IS NOT NULL",
            "expiresAt <= ?",
        ];
        const parameters: unknown[] = [
            GuildContractStatus.EXPIRED,
            GuildContractStatus.ACTIVE,
            now,
        ];
        if (userId) {
            conditions.push("profileUserId = ?");
            parameters.push(userId);
        }

        const result = await manager.query(
            `UPDATE guild_contract SET status = ? WHERE ${conditions.join(" AND ")}`,
            parameters,
        );
        // A stage contract can no longer be claimed once expired, so its chain
        // pointer must not keep pointing at it.
        const chainConditions = ["gc.status = ?"];
        const chainParameters: unknown[] = [GuildContractStatus.EXPIRED];
        if (userId) {
            chainConditions.push("c.profileUserId = ?");
            chainParameters.push(userId);
        }
        await manager.query(
            `UPDATE guild_user_chain c
             INNER JOIN guild_contract gc ON gc.id = c.activeContractId
             SET c.activeContractId = NULL
             WHERE ${chainConditions.join(" AND ")}`,
            chainParameters,
        );
        return Number(result.affectedRows ?? 0);
    }

    /** One contract evaluated with the real playtime/TTB services (claim re-check). */
    public async evaluateContractWithManager(
        manager: EntityManager,
        contract: GuildContract,
        now: Date,
    ): Promise<GuildObjectiveEvaluation> {
        return evaluateGuildObjective({
            query: manager,
            contract,
            now,
            playtimeHistory: this.playtimeHistoryService,
            timeToBeat: this.guildTimeToBeatService,
        });
    }

    public async evaluateUserContracts(
        userId: string,
        now = new Date(),
    ): Promise<void> {
        // Fast indexed exit for users holding no active contract.
        const activeContracts = await this.dataSource
            .getRepository(GuildContract)
            .find({
                where: {
                    profileUserId: userId,
                    status: GuildContractStatus.ACTIVE,
                },
                relations: { targetGame: true },
            });
        if (activeContracts.length === 0) return;

        await this.expireOverdueWithManager(
            this.dataSource.manager,
            userId,
            now,
        );

        for (const contract of activeContracts) {
            if (contract.expiresAt !== null && contract.expiresAt <= now)
                continue;

            const evaluation = await evaluateGuildObjective(
                this.evaluationContext(contract, now),
            );

            if (evaluation.progress >= contract.progressTarget) {
                const bonusCompleted = await this.bonusCompleted(
                    contract,
                    evaluation,
                    now,
                );
                await this.markReady(contract, now, bonusCompleted);
            } else if (evaluation.progress !== contract.progressCurrent) {
                await this.dataSource.getRepository(GuildContract).update(
                    {
                        id: contract.id,
                        status: GuildContractStatus.ACTIVE,
                    },
                    { progressCurrent: evaluation.progress },
                );
            }
        }
    }

    private evaluationContext(
        contract: GuildContract,
        now: Date,
    ): GuildEvaluationContext {
        return {
            query: this.dataSource,
            contract,
            now,
            playtimeHistory: this.playtimeHistoryService,
            timeToBeat: this.guildTimeToBeatService,
        };
    }

    /** A bonus failure is never allowed to block the base completion. */
    private async bonusCompleted(
        contract: GuildContract,
        evaluation: GuildObjectiveEvaluation,
        now: Date,
    ): Promise<boolean> {
        if (!contract.bonusObjective) return false;
        try {
            return await evaluateGuildBonusObjective({
                query: this.dataSource,
                contract,
                evaluation,
                now,
            });
        } catch (error) {
            this.logger.warn(
                `Guild bonus objective evaluation failed for contract ${contract.id}: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
            return false;
        }
    }

    private async markReady(
        contract: GuildContract,
        now: Date,
        bonusCompleted: boolean,
    ): Promise<void> {
        await this.dataSource.transaction(async (manager) => {
            const rows: Array<{
                id: string;
                status: GuildContractStatus;
                expiresAt: Date | null;
            }> = await manager.query(
                "SELECT id, status, expiresAt FROM guild_contract WHERE id = ? FOR UPDATE",
                [contract.id],
            );
            const locked = rows[0];
            if (!locked || locked.status !== GuildContractStatus.ACTIVE) return;
            if (locked.expiresAt !== null && new Date(locked.expiresAt) <= now)
                return;

            const result = await manager.query(
                `UPDATE guild_contract
                 SET status = ?, progressCurrent = ?, readyAt = ?, bonusCompleted = ?
                 WHERE id = ? AND status = ?`,
                [
                    GuildContractStatus.READY_TO_CLAIM,
                    contract.progressTarget,
                    now,
                    bonusCompleted,
                    contract.id,
                    GuildContractStatus.ACTIVE,
                ],
            );
            if (Number(result.affectedRows) !== 1) return;

            // Same transaction: the intent exists iff this transition happened.
            await appendNotificationIntent(manager, {
                eventType: "guild.contract-ready",
                eventVersion: 1,
                occurredAt: now,
                recipientUserId: contract.profileUserId,
                actorUserId: null,
                payload: {
                    contractId: contract.id,
                    category: contract.category,
                    templateKey: contract.templateKey,
                    eventId: contract.eventId,
                    targetGameId: contract.targetGameId,
                },
            });
        });
    }
}
