import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DataSource, EntityManager } from "typeorm";
import {
    CatalogStage,
    IgdbCatalogState,
} from "./entities/igdb-catalog-state.entity";
import { CATALOG_TIMING } from "./igdb-catalog.config";

export interface CatalogOwner {
    runId: string;
    ownerToken: string;
    ownerGeneration: number;
}

export class CatalogOwnershipLost extends Error {
    constructor() {
        super("Catalog run ownership is no longer valid");
    }
}

@Injectable()
export class IgdbCatalogStateService {
    constructor(private readonly source: DataSource) {}

    async gameTransaction<T>(
        owner: CatalogOwner,
        work: (manager: EntityManager) => Promise<T>,
    ): Promise<T> {
        const runner = this.source.createQueryRunner();
        const connection: { threadId: number; destroy(): void } =
            await runner.connect();
        let expired = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            await runner.query("SET SESSION innodb_lock_wait_timeout = 10");
            await runner.query("SET SESSION MAX_EXECUTION_TIME = 30000");
            // Server-side cancellation rolls back and rejects pending queries.
            // mysql2.destroy() alone does not reject a running query reliably.
            timer = setTimeout(() => {
                expired = true;
                void this.source
                    .query("KILL CONNECTION ?", [connection.threadId])
                    .catch(() => connection.destroy());
            }, 60_000);
            await runner.startTransaction();
            await this.assertOwnership(runner.manager, owner);
            const result = await work(runner.manager);
            if (expired)
                throw new Error("Catalog game transaction exceeded 60000 ms");
            await runner.commitTransaction();
            return result;
        } catch (error) {
            if (!expired && runner.isTransactionActive)
                await runner.rollbackTransaction();
            throw error;
        } finally {
            if (timer) clearTimeout(timer);
            if (!expired) {
                try {
                    await runner.query(
                        "SET SESSION innodb_lock_wait_timeout = DEFAULT",
                    );
                    await runner.query(
                        "SET SESSION MAX_EXECUTION_TIME = DEFAULT",
                    );
                } finally {
                    await runner.release();
                }
            } else {
                await runner.release();
            }
        }
    }

    async readStatus() {
        return this.source
            .getRepository(IgdbCatalogState)
            .findOneByOrFail({ id: 1 });
    }

    private async locked(manager: EntityManager) {
        return manager.getRepository(IgdbCatalogState).findOneOrFail({
            where: { id: 1 },
            lock: { mode: "pessimistic_write" },
        });
    }

    private async now(manager: EntityManager): Promise<Date> {
        const rows: { now: Date }[] = await manager.query(
            "SELECT UTC_TIMESTAMP(3) AS now",
        );
        return rows[0].now;
    }

    /** The caller must hold a transaction; keep its row lock through game commit. */
    async assertOwnership(manager: EntityManager, owner: CatalogOwner) {
        const state = await this.locked(manager);
        const now = await this.now(manager);
        if (
            state.status !== "running" ||
            state.runId !== owner.runId ||
            state.ownerGeneration !== owner.ownerGeneration ||
            state.ownerToken !== owner.ownerToken ||
            !state.leaseExpiresAt ||
            state.leaseExpiresAt <= now
        ) {
            throw new CatalogOwnershipLost();
        }
        return state;
    }

    async claimRun(expectedRunId?: string) {
        return this.source.transaction(async (manager) => {
            const state = await this.locked(manager);
            const now = await this.now(manager);
            if (
                state.status === "paused" ||
                (state.leaseExpiresAt && state.leaseExpiresAt > now)
            )
                return null;
            if (expectedRunId && state.runId !== expectedRunId) return null;
            if (state.status !== "running") {
                if (
                    expectedRunId ||
                    (state.nextEligibleAt && state.nextEligibleAt > now)
                )
                    return null;
                const force = state.status === "idle";
                Object.assign(state, {
                    runId: randomUUID(),
                    status: "running",
                    committedId: 0,
                    upperId: null,
                    committedGames: 0,
                    committedBatches: 0,
                    forceReconciliation: force,
                    startedAt: now,
                    completedAt: null,
                    nextEligibleAt: null,
                    retryStage: null,
                    retryGameId: null,
                    attempt: 0,
                    retryBudgets: null,
                    failureSummary: null,
                });
            }
            state.ownerGeneration++;
            state.ownerToken = randomUUID();
            state.leaseExpiresAt = new Date(
                now.getTime() + CATALOG_TIMING.leaseMs,
            );
            return manager.save(state);
        });
    }

    private async mutate<T>(
        owner: CatalogOwner,
        change: (state: IgdbCatalogState, manager: EntityManager) => Promise<T>,
    ) {
        return this.source.transaction(async (manager) => {
            const state = await this.assertOwnership(manager, owner);
            const result = await change(state, manager);
            await manager.save(state);
            return result;
        });
    }

    async renewLease(owner: CatalogOwner) {
        return this.mutate(owner, async (state, manager) => {
            state.leaseExpiresAt = new Date(
                (await this.now(manager)).getTime() + CATALOG_TIMING.leaseMs,
            );
        });
    }

    async setUpperId(owner: CatalogOwner, upperId: number) {
        return this.mutate(owner, async (state) => {
            if (
                !Number.isSafeInteger(upperId) ||
                upperId < 0 ||
                (state.upperId !== null && state.upperId !== upperId)
            ) {
                throw new Error(
                    "Catalog upper boundary must be a fixed nonnegative integer",
                );
            }
            state.upperId = upperId;
        });
    }

    async commitBatch(
        owner: CatalogOwner,
        previousId: number,
        maximumId: number,
        games: number,
    ) {
        return this.mutate(owner, async (state) => {
            if (state.committedId === maximumId && maximumId > previousId)
                return;
            if (
                state.committedId !== previousId ||
                !Number.isSafeInteger(maximumId) ||
                maximumId <= previousId ||
                state.upperId === null ||
                maximumId > state.upperId ||
                !Number.isInteger(games) ||
                games < 1
            ) {
                throw new Error("Invalid or replayed catalog checkpoint");
            }
            state.committedId = maximumId;
            state.committedGames += games;
            state.committedBatches++;
            state.retryBudgets = null;
            state.retryStage = null;
            state.retryGameId = null;
            state.attempt = 0;
            state.failureSummary = null;
        });
    }

    private stageKey(stage: CatalogStage, gameId: number | null) {
        return stage === "game" ? `game:${gameId}` : stage;
    }

    async readStageAttempts(
        owner: CatalogOwner,
        stage: CatalogStage,
        gameId: number | null,
    ) {
        return this.mutate(
            owner,
            async (state) =>
                state.retryBudgets?.[this.stageKey(stage, gameId)] ?? 0,
        );
    }

    async admitStageAttempt(
        owner: CatalogOwner,
        stage: CatalogStage,
        gameId: number | null,
        maximum: number,
    ) {
        return this.mutate(owner, async (state) => {
            const key = this.stageKey(stage, gameId);
            const attempts = state.retryBudgets ?? {};
            if (
                Object.keys(attempts).length > 504 ||
                (attempts[key] ?? 0) >= maximum
            )
                throw new Error("Catalog stage budget exhausted");
            const count = (attempts[key] ?? 0) + 1;
            state.retryBudgets = { ...attempts, [key]: count };
            state.retryStage = stage;
            state.retryGameId = gameId;
            state.attempt = count;
            return count;
        });
    }

    async finishAttemptStage(
        owner: CatalogOwner,
        stage: CatalogStage,
        gameId: number | null,
    ) {
        return this.mutate(owner, async (state) => {
            const attempts = { ...state.retryBudgets };
            delete attempts[this.stageKey(stage, gameId)];
            state.retryBudgets = attempts;
            if (state.retryStage === stage && state.retryGameId === gameId) {
                state.retryStage = null;
                state.retryGameId = null;
                state.attempt = 0;
            }
        });
    }

    async recordFailure(
        owner: CatalogOwner,
        stage: CatalogStage,
        gameId: number | null,
        summary: string,
    ) {
        return this.mutate(owner, async (state) => {
            state.retryStage = stage;
            state.retryGameId = gameId;
            state.attempt =
                state.retryBudgets?.[this.stageKey(stage, gameId)] ?? 0;
            state.failureSummary = summary.slice(0, 512);
        });
    }

    async pauseRun(owner: CatalogOwner, failureSummary: string) {
        return this.mutate(owner, async (state, manager) => {
            state.status = "paused";
            // Callers provide a classified summary, never raw HTTP errors or payloads.
            state.failureSummary = failureSummary.slice(0, 512);
            // The scheduler resumes the run automatically after this cooldown.
            state.nextEligibleAt = new Date(
                (await this.now(manager)).getTime() +
                    CATALOG_TIMING.pauseRetryMs,
            );
            state.ownerToken = null;
            state.leaseExpiresAt = null;
        });
    }

    async completeRun(owner: CatalogOwner, intervalDays: number) {
        if (intervalDays !== 7 && intervalDays !== 14)
            throw new Error("Invalid catalog interval");
        return this.mutate(owner, async (state, manager) => {
            if (state.upperId === null)
                throw new Error("Catalog upper boundary is not set");
            state.completedAt = await this.now(manager);
            state.nextEligibleAt = new Date(
                state.completedAt.getTime() + intervalDays * 86_400_000,
            );
            state.status = "completed";
            state.retryBudgets = null;
            state.ownerToken = null;
            state.leaseExpiresAt = null;
            state.retryStage = null;
            state.retryGameId = null;
            state.attempt = 0;
            state.failureSummary = null;
        });
    }

    /** With onlyIfDue, returns null unless a paused run's cooldown has elapsed. */
    async resumeRun(onlyIfDue = false) {
        return this.source.transaction(async (manager) => {
            const state = await this.locked(manager);
            if (
                onlyIfDue &&
                (state.status !== "paused" ||
                    (state.nextEligibleAt &&
                        state.nextEligibleAt > (await this.now(manager))))
            )
                return null;
            if (state.status !== "paused")
                throw new Error("Only a paused catalog run can be resumed");
            state.status = "running";
            state.attempt = 0;
            state.retryBudgets = null;
            state.retryStage = null;
            state.retryGameId = null;
            state.failureSummary = null;
            state.nextEligibleAt = null;
            state.ownerToken = null;
            state.leaseExpiresAt = null;
            return manager.save(state);
        });
    }

    async releaseOwnership(owner: CatalogOwner) {
        return this.mutate(owner, async (state) => {
            state.ownerToken = null;
            state.leaseExpiresAt = null;
        });
    }
}
