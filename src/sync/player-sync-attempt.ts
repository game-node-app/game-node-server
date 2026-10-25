import { Logger } from "@nestjs/common";
import type { PlayerSyncOwner } from "./player-data/player-sync-state.service";
import { withPlayerProviderBudget } from "./player-provider-budget.service";
import { AsyncLocalStorage } from "node:async_hooks";
import { providerFailure, ProviderSyncError } from "./provider-sync.error";

export const PLAYER_REQUEST_TIMEOUT_MS = 30_000;
export const PLAYER_ATTEMPT_TIMEOUT_MS = 10 * 60_000;
export interface PlayerSyncStats {
    providerCalls: number;
    gamesSeen: number;
    gamesSelected: number;
    gamesSkipped: number;
    gamesChanged: number;
    stagesSucceeded: number;
    stagesFailed: number;
    imported: number;
    skippedImports: number;
    failedImports: number;
}
const summaryLogger = new Logger("PlayerSync");
const attempts = new AsyncLocalStorage<{
    stats: PlayerSyncStats;
    deadline: number;
    signal: AbortSignal;
    observedAt: Date;
    owner?: PlayerSyncOwner;
    snapshots: Map<string, Promise<unknown>>;
    write?: <T>(work: () => Promise<T>) => Promise<T>;
}>();

export function assertPlayerSyncActive() {
    const attempt = attempts.getStore();
    if (attempt && (attempt.signal.aborted || Date.now() >= attempt.deadline))
        throw new ProviderSyncError(
            "failed",
            "Player synchronization attempt deadline exceeded",
        );
}

export async function runPlayerSyncAttempt<T>(
    work: () => Promise<T>,
): Promise<T> {
    if (attempts.getStore()) return work();
    const controller = new AbortController();
    const timer = setTimeout(
        () => controller.abort(),
        PLAYER_ATTEMPT_TIMEOUT_MS,
    );
    try {
        return await attempts.run(
            {
                stats: {
                    providerCalls: 0,
                    gamesSeen: 0,
                    gamesSelected: 0,
                    gamesSkipped: 0,
                    gamesChanged: 0,
                    stagesSucceeded: 0,
                    stagesFailed: 0,
                    imported: 0,
                    skippedImports: 0,
                    failedImports: 0,
                },
                deadline: Date.now() + PLAYER_ATTEMPT_TIMEOUT_MS,
                signal: controller.signal,
                observedAt: new Date(),
                snapshots: new Map(),
            },
            async () => {
                const result = await work();
                assertPlayerSyncActive();
                return result;
            },
        );
    } finally {
        clearTimeout(timer);
    }
}

export function recordPlayerSyncStats(delta: Partial<PlayerSyncStats>) {
    const stats = attempts.getStore()?.stats;
    if (!stats) return;
    for (const key of Object.keys(delta) as (keyof PlayerSyncStats)[]) {
        // Discovery/playtime can see the same complete library in one attempt.
        stats[key] =
            key === "gamesSeen"
                ? Math.max(stats[key], delta[key] ?? 0)
                : stats[key] + (delta[key] ?? 0);
    }
}

export function currentPlayerSyncOwner() {
    return attempts.getStore()?.owner;
}

export function currentPlayerSyncObservationAt() {
    const observedAt = attempts.getStore()?.observedAt;
    return observedAt ? new Date(observedAt.getTime()) : undefined;
}

export async function runWithPlayerSyncOwner<T>(
    owner: PlayerSyncOwner,
    write: <R>(work: () => Promise<R>) => Promise<R>,
    work: () => Promise<T>,
): Promise<T> {
    const attempt = attempts.getStore();
    if (!attempt) throw new Error("Player synchronization attempt is required");
    return attempts.run({ ...attempt, owner, write }, work);
}

export async function playerSyncWrite<T>(work: () => Promise<T>): Promise<T> {
    assertPlayerSyncActive();
    const guarded = async () => {
        const result = await work();
        assertPlayerSyncActive();
        return result;
    };
    return attempts.getStore()?.write?.(guarded) ?? guarded();
}

export function PlayerLibrarySnapshot() {
    return (target: object, name: string, descriptor: PropertyDescriptor) => {
        const original = descriptor.value;
        descriptor.value = function (...args: unknown[]) {
            const snapshots = attempts.getStore()?.snapshots;
            if (!snapshots) return original.apply(this, args);
            const key = `${target.constructor.name}:${name}:${JSON.stringify(args)}`;
            let pending = snapshots.get(key);
            if (!pending) {
                pending = Promise.resolve()
                    .then(() => original.apply(this, args))
                    .catch((error) => {
                        snapshots.delete(key);
                        throw error;
                    });
                snapshots.set(key, pending);
            }
            return pending;
        };
    };
}

export function PlayerSyncWrite() {
    return (
        _target: unknown,
        _name: string,
        descriptor: PropertyDescriptor,
    ) => {
        const original = descriptor.value;
        descriptor.value = function (...args: unknown[]) {
            return playerSyncWrite(() => original.apply(this, args));
        };
    };
}

export function PlayerSyncAttempt() {
    return (
        _target: unknown,
        _name: string,
        descriptor: PropertyDescriptor,
    ) => {
        const original = descriptor.value;
        descriptor.value = function (...args: unknown[]) {
            return runPlayerSyncAttempt(async () => {
                const started = Date.now();
                const job = args[0] as {
                    data?: {
                        owner?: { source?: string; externalGameId?: number };
                        source?: string;
                    };
                    timestamp?: number;
                    attemptsMade?: number;
                };
                const source = job?.data?.owner?.source ?? job?.data?.source;
                let outcome = "failed";
                try {
                    const result = await original.apply(this, args);
                    assertPlayerSyncActive();
                    outcome =
                        typeof result === "string"
                            ? result
                            : (result?.outcome ?? "complete");
                    return result;
                } catch (error) {
                    if (error instanceof ProviderSyncError)
                        outcome = error.outcome;
                    if (
                        error instanceof ProviderSyncError &&
                        error.outcome === "unsupported"
                    )
                        return { outcome: "unsupported" };
                    throw error;
                } finally {
                    const stats = attempts.getStore()!.stats;
                    if (stats.stagesFailed && stats.stagesSucceeded)
                        outcome = "partial";
                    else if (
                        outcome === "complete" &&
                        !stats.gamesSeen &&
                        !stats.gamesChanged
                    )
                        outcome = "empty";
                    summaryLogger.log({
                        event: "player-sync-run",
                        kind:
                            (_target as object).constructor.name ===
                            "GameAchievementSyncProcessor"
                                ? "achievement"
                                : "full",
                        source: ["steam", "psn", "xbox"].includes(source ?? "")
                            ? source
                            : "unknown",
                        outcome,
                        durationMs: Date.now() - started,
                        queueAgeMs: Math.max(
                            0,
                            started - (job?.timestamp ?? started),
                        ),
                        retries: job?.attemptsMade ?? 0,
                        ...stats,
                    });
                }
            });
        };
    };
}

export async function cancellableProviderCall<T>(
    provider: string,
    work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
    return withPlayerProviderBudget(
        provider,
        async () => {
            assertPlayerSyncActive();
            const controller = new AbortController();
            const parent = attempts.getStore()?.signal;
            const abort = () => controller.abort();
            const timer = setTimeout(abort, PLAYER_REQUEST_TIMEOUT_MS);
            parent?.addEventListener("abort", abort, { once: true });
            if (parent?.aborted) abort();
            try {
                recordPlayerSyncStats({ providerCalls: 1 });
                const result = await work(controller.signal);
                assertPlayerSyncActive();
                if (controller.signal.aborted)
                    throw new ProviderSyncError(
                        "failed",
                        "Provider request deadline exceeded",
                    );
                return result;
            } catch (cause) {
                throw providerFailure(provider, cause);
            } finally {
                clearTimeout(timer);
                parent?.removeEventListener("abort", abort);
            }
        },
        attempts.getStore()?.signal,
    );
}

export async function uncancellableProviderCall<T>(
    provider: string,
    work: () => Promise<T>,
): Promise<T> {
    assertPlayerSyncActive();
    return withPlayerProviderBudget(
        provider,
        async () => {
            assertPlayerSyncActive();
            try {
                recordPlayerSyncStats({ providerCalls: 1 });
                const result = await work();
                assertPlayerSyncActive();
                return result;
            } catch (cause) {
                throw providerFailure(provider, cause);
            }
        },
        attempts.getStore()?.signal,
    );
}
