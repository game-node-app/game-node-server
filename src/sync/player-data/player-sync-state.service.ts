import { ACHIEVEMENT_CONNECTION_SOURCE } from "../../game/game-achievement/game-achievement.constants";
import { GameExternalGame } from "../../game/external-game/entity/game-external-game.entity";
import {
    PLAYER_REFRESH_INTERVAL_MS,
    PLAYER_RECONCILE_INTERVAL_MS,
    playerBootstrapAt,
    playerGameSelection,
    PlayerGameSelectionReason,
} from "./player-sync-policy";
import { runInTransaction } from "typeorm-transactional";
import { BadRequestException, Injectable } from "@nestjs/common";
import { DataSource, EntityManager, Not } from "typeorm";
import { randomUUID } from "node:crypto";
import { Queue, UnrecoverableError } from "bullmq";
import { UserConnection } from "../../connection/entity/user-connection.entity";
import { EConnectionType } from "../../connection/connections.constants";
import {
    PlayerConnectionSync,
    PlayerSyncOutcome,
    PlayerSyncStage,
} from "./entity/player-connection-sync.entity";
import { PlayerGameSync } from "./entity/player-game-sync.entity";
import {
    assertPlayerSyncActive,
    runPlayerSyncAttempt,
    runWithPlayerSyncOwner,
    PLAYER_ATTEMPT_TIMEOUT_MS,
} from "../player-sync-attempt";
import { ProviderSyncError } from "../provider-sync.error";

export const PLAYER_OWNER_LEASE_MS = 90_000;
export interface PlayerSyncOwner {
    connectionId: number;
    sourceUserId: string;
    userId: string;
    source: EConnectionType;
    ownerToken: string;
    externalGameId?: number;
    reason?: PlayerGameSelectionReason;
}
export class PlayerSyncOwnershipLost extends UnrecoverableError {
    constructor() {
        super("Player synchronization ownership is no longer current");
    }
}
const successful = (outcome: PlayerSyncOutcome) =>
    ["complete", "empty", "unsupported"].includes(outcome);

@Injectable()
export class PlayerSyncStateService {
    constructor(private readonly source: DataSource) {}

    private async now(manager: EntityManager): Promise<Date> {
        const [row]: { nowMs: string }[] = await manager.query(
            "SELECT UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000 AS nowMs",
        );
        return new Date(Number(row.nowMs));
    }

    private async connection(
        manager: EntityManager,
        connectionId: number,
        sourceUserId: string,
    ) {
        const connection = await manager
            .getRepository(UserConnection)
            .createQueryBuilder("connection")
            .select([
                "connection.id",
                "connection.profileUserId",
                "connection.sourceUserId",
                "connection.type",
            ])
            .where("connection.id = :connectionId", { connectionId })
            .setLock("pessimistic_write")
            .getOne();
        if (!connection || connection.sourceUserId !== sourceUserId)
            throw new PlayerSyncOwnershipLost();
        return connection;
    }

    async findConnection(userId: string, source: EConnectionType) {
        if (!Object.values(EConnectionType).includes(source))
            throw new BadRequestException("Unsupported player source");
        return this.source.getRepository(UserConnection).findOne({
            where: { profileUserId: userId, type: source },
            select: {
                id: true,
                profileUserId: true,
                sourceUserId: true,
                type: true,
            },
        });
    }

    private async assertGameSource(
        manager: EntityManager,
        externalGameId: number,
        source: EConnectionType,
    ) {
        if (!Number.isSafeInteger(externalGameId) || externalGameId <= 0)
            throw new BadRequestException("Invalid external game identity");
        const game = await manager.getRepository(GameExternalGame).findOne({
            where: { id: externalGameId },
            select: { id: true, category: true },
        });
        if (
            !game ||
            ACHIEVEMENT_CONNECTION_SOURCE.get(game.category!) !== source
        )
            throw new BadRequestException(
                "Achievement game does not belong to the requested source",
            );
    }

    async gameStatus(
        userId: string,
        source: EConnectionType,
        externalGameId: number,
    ) {
        const connection = await this.findConnection(userId, source);
        await this.assertGameSource(
            this.source.manager,
            externalGameId,
            source,
        );
        if (!connection)
            return { source, externalGameId, status: "disconnected" as const };
        const state = await this.source
            .getRepository(PlayerGameSync)
            .findOneBy({
                connectionId: connection.id,
                externalGameId,
                sourceUserId: connection.sourceUserId,
            });
        if (!state)
            return {
                source,
                externalGameId,
                status: "unknown" as const,
                outcome: "unknown",
                pending: false,
            };
        const now = await this.now(this.source.manager);
        const pending = !!state.leaseExpiresAt && state.leaseExpiresAt > now;
        return {
            source,
            externalGameId,
            outcome: state.outcome,
            status: pending
                ? "pending"
                : state.nextEligibleAt > now
                  ? "cooldown"
                  : state.retryAt && state.retryAt > now
                    ? "failed"
                    : "eligible",
            pending,
            lastSucceededAt: state.checkedAt,
            nextEligibleAt: state.nextEligibleAt,
            retryAt: state.retryAt,
        };
    }

    async write<T>(owner: PlayerSyncOwner, work: () => Promise<T>) {
        return this.ownedTransaction(owner, async () => work());
    }

    async initialize(connectionId: number, sourceUserId: string, dueAt: Date) {
        return runInTransaction(
            async () => {
                const manager = this.source.manager;
                await this.connection(manager, connectionId, sourceUserId);
                const repo = manager.getRepository(PlayerConnectionSync);
                const existing = await repo.findOneBy({ connectionId });
                if (existing?.sourceUserId === sourceUserId) return existing;
                await manager.delete(
                    PlayerGameSync,
                    existing
                        ? { connectionId }
                        : { connectionId, sourceUserId: Not(sourceUserId) },
                );
                if (existing) await repo.delete({ connectionId });
                return repo.save(
                    repo.create({
                        connectionId,
                        sourceUserId,
                        nextEligibleAt: dueAt,
                        stages: {
                            playtime: {
                                outcome: "unknown",
                                lastSucceededAt: null,
                                nextEligibleAt: dueAt.toISOString(),
                            },
                            discovery: {
                                outcome: "unknown",
                                lastSucceededAt: null,
                                nextEligibleAt: dueAt.toISOString(),
                            },
                        },
                    }),
                );
            },
            { connectionName: this.source.name },
        );
    }

    async initializeExisting(connectionId: number, sourceUserId: string) {
        const now = await this.now(this.source.manager);
        return this.initialize(
            connectionId,
            sourceUserId,
            playerBootstrapAt(connectionId, sourceUserId, now),
        );
    }

    async bootstrapExisting() {
        let cursor = 0;
        const now = await this.now(this.source.manager);
        while (true) {
            const connections = await this.source
                .getRepository(UserConnection)
                .createQueryBuilder("connection")
                .select(["connection.id", "connection.sourceUserId"])
                .leftJoin(
                    PlayerConnectionSync,
                    "state",
                    "state.connectionId = connection.id AND state.sourceUserId = connection.sourceUserId",
                )
                .where("connection.id > :cursor", { cursor })
                .andWhere("state.connectionId IS NULL")
                .andWhere("connection.type IN (:...sources)", {
                    sources: Object.values(EConnectionType),
                })
                .orderBy("connection.id")
                .take(100)
                .getMany();
            if (!connections.length) return;
            for (const connection of connections) {
                try {
                    await this.initialize(
                        connection.id,
                        connection.sourceUserId,
                        playerBootstrapAt(
                            connection.id,
                            connection.sourceUserId,
                            now,
                        ),
                    );
                } catch (error) {
                    if (!(error instanceof PlayerSyncOwnershipLost))
                        throw error;
                }
            }
            cursor = connections[connections.length - 1].id;
        }
    }

    async due(cursor?: { at: Date; id: number }) {
        const now = await this.now(this.source.manager);
        const query = this.source
            .getRepository(PlayerConnectionSync)
            .createQueryBuilder("state")
            .where("state.nextEligibleAt <= :now", { now })
            .andWhere("(state.retryAt IS NULL OR state.retryAt <= :now)")
            .andWhere(
                "(state.leaseExpiresAt IS NULL OR state.leaseExpiresAt <= :now)",
            );
        if (cursor)
            query.andWhere(
                "(state.nextEligibleAt > :at OR (state.nextEligibleAt = :at AND state.connectionId > :id))",
                cursor,
            );
        return query
            .orderBy("state.nextEligibleAt")
            .addOrderBy("state.connectionId")
            .take(100)
            .getMany();
    }

    async status(userId: string, source: EConnectionType) {
        const connection = await this.findConnection(userId, source);
        if (!connection) return { source, status: "disconnected" as const };
        const state = await this.source
            .getRepository(PlayerConnectionSync)
            .findOneBy({
                connectionId: connection.id,
                sourceUserId: connection.sourceUserId,
            });
        if (!state)
            return {
                source,
                status: "unknown" as const,
                outcome: "unknown",
                lastSucceededAt: null,
                nextEligibleAt: null,
                pending: false,
            };
        const now = await this.now(this.source.manager);
        const pending =
            !!state.ownerToken &&
            !!state.leaseExpiresAt &&
            state.leaseExpiresAt > now;
        const outcome =
            !pending && state.ownerToken ? "incomplete" : state.outcome;
        const nextEligibleAt = new Date(
            Math.max(
                state.nextEligibleAt.getTime(),
                state.retryAt?.getTime() ?? 0,
            ),
        );
        return {
            source,
            status: pending
                ? ("pending" as const)
                : !successful(outcome) && outcome !== "unknown"
                  ? ("failed" as const)
                  : nextEligibleAt > now
                    ? ("cooldown" as const)
                    : ("eligible" as const),
            outcome,
            lastSucceededAt: state.lastSucceededAt,
            nextEligibleAt,
            pending,
            stages: state.stages,
        };
    }

    async dueStages(owner: PlayerSyncOwner) {
        return this.ownedTransaction(owner, async (_manager, state, now) => {
            if (!(state instanceof PlayerConnectionSync))
                throw new Error("A full refresh owner is required");
            return (Object.keys(state.stages) as PlayerSyncStage[]).filter(
                (stage) =>
                    Date.parse(state.stages[stage].nextEligibleAt) <=
                    now.getTime(),
            );
        });
    }

    async failStage(
        owner: PlayerSyncOwner,
        stage: PlayerSyncStage,
        error: ProviderSyncError,
    ) {
        return this.ownedTransaction(owner, async (_manager, state) => {
            if (!(state instanceof PlayerConnectionSync))
                throw new Error("A full refresh owner is required");
            state.stages[stage].outcome = error.outcome;
            state.outcome = error.outcome;
        });
    }

    async claim(
        connectionId: number,
        sourceUserId: string,
        externalGameId?: number,
        fingerprint?: string,
    ): Promise<PlayerSyncOwner | null> {
        return this.source.transaction(async (manager) => {
            const connection = await this.connection(
                manager,
                connectionId,
                sourceUserId,
            );
            const now = await this.now(manager);
            let state: PlayerConnectionSync | PlayerGameSync | null;
            if (externalGameId == null)
                state = await manager.findOneBy(PlayerConnectionSync, {
                    connectionId,
                });
            else {
                await this.assertGameSource(
                    manager,
                    externalGameId,
                    connection.type,
                );
                state = await manager.findOneBy(PlayerGameSync, {
                    connectionId,
                    externalGameId,
                });
                if (!state)
                    state = await manager.save(
                        PlayerGameSync,
                        manager.create(PlayerGameSync, {
                            connectionId,
                            externalGameId,
                            sourceUserId,
                            nextEligibleAt: now,
                            reconcileAt: now,
                        }),
                    );
            }
            if (
                !state ||
                state.sourceUserId !== sourceUserId ||
                state.nextEligibleAt > now ||
                (state.retryAt && state.retryAt > now) ||
                (state.leaseExpiresAt && state.leaseExpiresAt > now)
            )
                return null;
            const reason =
                state instanceof PlayerGameSync
                    ? playerGameSelection(state, fingerprint, now)
                    : undefined;
            if (state instanceof PlayerGameSync && !reason) return null;
            state.ownerToken = randomUUID();
            state.attemptStartedAt = null;
            // Admission also covers queue delay; execution switches to a renewable short lease.
            state.leaseExpiresAt = new Date(
                now.getTime() + PLAYER_ATTEMPT_TIMEOUT_MS,
            );
            await manager.save(state);
            return {
                connectionId,
                sourceUserId,
                userId: connection.profileUserId,
                source: connection.type,
                ownerToken: state.ownerToken,
                ...(externalGameId == null ? {} : { externalGameId, reason }),
            };
        });
    }

    private async lockedOwner(manager: EntityManager, owner: PlayerSyncOwner) {
        const connection = await this.connection(
            manager,
            owner.connectionId,
            owner.sourceUserId,
        );
        if (
            connection.profileUserId !== owner.userId ||
            connection.type !== owner.source
        )
            throw new PlayerSyncOwnershipLost();
        if (owner.externalGameId != null)
            await this.assertGameSource(
                manager,
                owner.externalGameId,
                owner.source,
            );
        const state =
            owner.externalGameId == null
                ? await manager.findOne(PlayerConnectionSync, {
                      where: { connectionId: owner.connectionId },
                      lock: { mode: "pessimistic_write" },
                  })
                : await manager.findOne(PlayerGameSync, {
                      where: {
                          connectionId: owner.connectionId,
                          externalGameId: owner.externalGameId,
                      },
                      lock: { mode: "pessimistic_write" },
                  });
        const now = await this.now(manager);
        if (
            !state ||
            state.sourceUserId !== owner.sourceUserId ||
            state.ownerToken !== owner.ownerToken ||
            !state.leaseExpiresAt ||
            state.leaseExpiresAt <= now ||
            (state.attemptStartedAt &&
                state.attemptStartedAt.getTime() + PLAYER_ATTEMPT_TIMEOUT_MS <=
                    now.getTime())
        )
            throw new PlayerSyncOwnershipLost();
        return { state, now };
    }

    async ownedTransaction<T>(
        owner: PlayerSyncOwner,
        work: (
            manager: EntityManager,
            state: PlayerConnectionSync | PlayerGameSync,
            now: Date,
        ) => Promise<T>,
    ): Promise<T> {
        assertPlayerSyncActive();
        return runInTransaction(
            async () => {
                const manager = this.source.manager;
                const { state, now } = await this.lockedOwner(manager, owner);
                const leaseExpiresAt = state.leaseExpiresAt!;
                const result = await work(manager, state, now);
                assertPlayerSyncActive();
                if (leaseExpiresAt <= (await this.now(manager)))
                    throw new PlayerSyncOwnershipLost();
                await manager.save(state);
                return result;
            },
            { connectionName: this.source.name },
        );
    }

    async start(owner: PlayerSyncOwner) {
        return this.ownedTransaction(owner, async (_manager, state, now) => {
            state.attemptStartedAt ??= now;
            state.leaseExpiresAt = new Date(
                Math.min(
                    now.getTime() + PLAYER_OWNER_LEASE_MS,
                    state.attemptStartedAt.getTime() +
                        PLAYER_ATTEMPT_TIMEOUT_MS,
                ),
            );
        });
    }
    async renew(owner: PlayerSyncOwner) {
        return this.ownedTransaction(owner, async (_manager, state, now) => {
            if (!state.attemptStartedAt) throw new PlayerSyncOwnershipLost();
            state.leaseExpiresAt = new Date(
                Math.min(
                    now.getTime() + PLAYER_OWNER_LEASE_MS,
                    state.attemptStartedAt.getTime() +
                        PLAYER_ATTEMPT_TIMEOUT_MS,
                ),
            );
        });
    }

    async runOwned<T>(
        owner: PlayerSyncOwner,
        work: () => Promise<T>,
    ): Promise<T> {
        await this.start(owner);
        let pending: Promise<unknown> | undefined;
        const timer = setInterval(() => {
            if (!pending)
                pending = this.renew(owner)
                    .catch(() => clearInterval(timer))
                    .finally(() => {
                        pending = undefined;
                    });
        }, PLAYER_OWNER_LEASE_MS / 3);
        try {
            return await runPlayerSyncAttempt(() =>
                runWithPlayerSyncOwner(
                    owner,
                    (work) => this.write(owner, work),
                    work,
                ),
            );
        } finally {
            clearInterval(timer);
            await pending;
        }
    }

    async enqueue(
        owner: PlayerSyncOwner,
        queue: Pick<Queue, "add" | "getJob">,
        name: string,
        data: Record<string, unknown>,
    ) {
        const jobId = `player-sync-${owner.ownerToken}`;
        try {
            await this.assertCurrent(owner);
            return await queue.add(name, { ...data, owner }, { jobId });
        } catch (error) {
            try {
                if (!(await queue.getJob(jobId))) await this.compensate(owner);
            } catch {
                // An uncertain enqueue or stale owner recovers through lease expiry.
            }
            throw error;
        }
    }

    async assertCurrent(owner: PlayerSyncOwner) {
        assertPlayerSyncActive();
        await this.source.transaction(async (manager) => {
            await this.lockedOwner(manager, owner);
            assertPlayerSyncActive();
        });
    }

    async compensate(owner: PlayerSyncOwner) {
        return this.ownedTransaction(owner, async (_manager, state) => {
            if (state.attemptStartedAt) return;
            state.ownerToken = null;
            state.leaseExpiresAt = null;
        });
    }

    async completeStage(
        owner: PlayerSyncOwner,
        stage: PlayerSyncStage,
        outcome: "complete" | "empty",
    ) {
        return this.ownedTransaction(owner, async (_manager, state, now) => {
            if (!(state instanceof PlayerConnectionSync))
                throw new Error("A full refresh owner is required");
            state.stages[stage] = {
                outcome,
                lastSucceededAt: now.toISOString(),
                nextEligibleAt: new Date(
                    now.getTime() + PLAYER_REFRESH_INTERVAL_MS,
                ).toISOString(),
            };
        });
    }

    async finish(owner: PlayerSyncOwner, error?: ProviderSyncError) {
        return this.ownedTransaction(owner, async (_manager, state, now) => {
            if (error) {
                state.outcome = error.outcome;
                state.retryAt = new Date(
                    now.getTime() +
                        Math.max(60 * 60_000, error.retryAfterMs ?? 0),
                );
            } else if (state instanceof PlayerConnectionSync) {
                const stages = Object.values(state.stages);
                state.nextEligibleAt = new Date(
                    Math.min(
                        ...stages.map((stage) =>
                            Date.parse(stage.nextEligibleAt),
                        ),
                    ),
                );
                if (stages.every((stage) => successful(stage.outcome))) {
                    state.lastSucceededAt = now;
                    state.nextEligibleAt = new Date(
                        now.getTime() + PLAYER_REFRESH_INTERVAL_MS,
                    );
                    for (const stage of Object.values(state.stages))
                        stage.nextEligibleAt =
                            state.nextEligibleAt.toISOString();
                    state.outcome = stages.every(
                        (stage) => stage.outcome === "empty",
                    )
                        ? "empty"
                        : "complete";
                }
                state.retryAt = null;
            }
            state.ownerToken = null;
            state.leaseExpiresAt = null;
        });
    }

    async completeGame(
        owner: PlayerSyncOwner,
        outcome: "complete" | "empty" | "unsupported",
        fingerprint: string | null,
        transactionManager?: EntityManager,
    ) {
        const complete = async (
            state: PlayerConnectionSync | PlayerGameSync,
            now: Date,
        ) => {
            if (!(state instanceof PlayerGameSync))
                throw new Error("A game refresh owner is required");
            state.checkedAt = now;
            state.outcome = outcome;
            state.activityFingerprint = fingerprint;
            state.nextEligibleAt = new Date(
                now.getTime() + PLAYER_REFRESH_INTERVAL_MS,
            );
            state.reconcileAt = new Date(
                now.getTime() + PLAYER_RECONCILE_INTERVAL_MS,
            );
            state.retryAt = null;
            state.ownerToken = null;
            state.leaseExpiresAt = null;
        };

        if (transactionManager) {
            assertPlayerSyncActive();
            const { state, now } = await this.lockedOwner(
                transactionManager,
                owner,
            );
            await complete(state, now);
            assertPlayerSyncActive();
            await transactionManager.save(state);
            return;
        }

        return this.ownedTransaction(owner, async (_manager, state, now) =>
            complete(state, now),
        );
    }
}
