import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DataSource, EntityManager } from "typeorm";
import { IgdbDeltaState } from "./entities/igdb-delta-state.entity";
import { IgdbCatalogState } from "./entities/igdb-catalog-state.entity";
import { CatalogOwnershipLost } from "./igdb-catalog-state.service";
import { CATALOG_TIMING } from "./igdb-catalog.config";

export const DELTA_TIMING = {
    intervalMs: 300000,
    overlapMs: 600000,
    lagMs: 60000,
} as const;
export interface DeltaOwner {
    ownerToken: string;
    ownerGeneration: number;
}

@Injectable()
export class IgdbDeltaStateService {
    constructor(private readonly source: DataSource) {}

    private async now(manager: EntityManager): Promise<Date> {
        return (await manager.query("SELECT UTC_TIMESTAMP(3) AS now"))[0].now;
    }
    private locked(manager: EntityManager, stream: string) {
        return manager.getRepository(IgdbDeltaState).findOneOrFail({
            where: { stream },
            lock: { mode: "pessimistic_write" },
        });
    }
    async assertOwnership(manager: EntityManager, owner: DeltaOwner) {
        const lease = await this.locked(manager, "lease");
        if (
            lease.ownerToken !== owner.ownerToken ||
            lease.ownerGeneration !== owner.ownerGeneration ||
            !lease.leaseExpiresAt ||
            lease.leaseExpiresAt <= (await this.now(manager))
        )
            throw new CatalogOwnershipLost();
        return lease;
    }
    async claim() {
        return this.source.transaction(async (manager) => {
            const lease = await this.locked(manager, "lease");
            const now = await this.now(manager);
            if (
                (lease.leaseExpiresAt && lease.leaseExpiresAt > now) ||
                (lease.pausedUntil && lease.pausedUntil > now)
            )
                return null;
            lease.ownerToken = randomUUID();
            lease.ownerGeneration++;
            lease.leaseExpiresAt = new Date(+now + CATALOG_TIMING.leaseMs);
            return manager.save(lease);
        });
    }
    async renew(owner: DeltaOwner) {
        return this.source.transaction(async (manager) => {
            const lease = await this.assertOwnership(manager, owner);
            lease.leaseExpiresAt = new Date(
                +(await this.now(manager)) + CATALOG_TIMING.leaseMs,
            );
            await manager.save(lease);
        });
    }
    async release(owner: DeltaOwner) {
        return this.source.transaction(async (manager) => {
            const lease = await this.assertOwnership(manager, owner);
            lease.ownerToken = null;
            lease.leaseExpiresAt = null;
            lease.pausedUntil = new Date(
                +(await this.now(manager)) + DELTA_TIMING.intervalMs,
            );
            await manager.save(lease);
        });
    }
    async window(owner: DeltaOwner, stream: string, intervalDays: number) {
        return this.source.transaction(async (manager) => {
            await this.assertOwnership(manager, owner);
            const now = await this.now(manager);
            let state = await manager.findOneBy(IgdbDeltaState, { stream });
            if (!state) {
                const catalog = await manager.findOneByOrFail(
                    IgdbCatalogState,
                    { id: 1 },
                );
                state = manager.create(IgdbDeltaState, {
                    stream,
                    watermark:
                        catalog.startedAt ??
                        new Date(+now - intervalDays * 86400000),
                });
            }
            if (state.pausedUntil && state.pausedUntil > now) return null;
            if (!state.windowEnd) {
                state.windowStart = new Date(
                    Math.max(0, +state.watermark! - DELTA_TIMING.overlapMs),
                );
                state.windowEnd = new Date(
                    Math.floor((+now - DELTA_TIMING.lagMs) / 1000) * 1000,
                );
                state.cursor = 0;
                if (state.windowEnd <= state.windowStart) return null;
            }
            state.failureSummary = null;
            state.pausedUntil = null;
            return manager.save(state);
        });
    }
    async checkpoint(
        owner: DeltaOwner,
        stream: string,
        previous: number,
        cursor: number | null,
    ) {
        return this.source.transaction(async (manager) => {
            await this.assertOwnership(manager, owner);
            const state = await this.locked(manager, stream);
            if (
                state.cursor !== previous ||
                !state.windowEnd ||
                (cursor !== null &&
                    (!Number.isSafeInteger(cursor) || cursor <= previous))
            )
                throw new Error("Invalid delta checkpoint");
            if (cursor === null) {
                state.watermark = state.windowEnd;
                state.windowStart = state.windowEnd = null;
                state.cursor = 0;
            } else state.cursor = cursor;
            await manager.save(state);
        });
    }
    async pause(owner: DeltaOwner, stream: string, summary: string) {
        return this.source.transaction(async (manager) => {
            await this.assertOwnership(manager, owner);
            const state = await this.locked(manager, stream);
            state.failureSummary = summary.slice(0, 512);
            state.pausedUntil = new Date(
                +(await this.now(manager)) + CATALOG_TIMING.pauseRetryMs,
            );
            await manager.save(state);
        });
    }
}
