import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { randomUUID } from "node:crypto";
import { ProviderSyncError } from "./provider-sync.error";

export const PLAYER_PROVIDER_BUDGET_QUEUE = "player-provider-budget";
const LEASE_MS = 90_000;
const ACQUIRE = `
local clock = redis.call('TIME')
local now = clock[1] * 1000 + math.floor(clock[2] / 1000)
local cooldown = tonumber(redis.call('GET', KEYS[2]) or '0')
if cooldown > now then return cooldown - now end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZCARD', KEYS[1]) >= 2 then return 100 end
redis.call('ZADD', KEYS[1], now + 90000, ARGV[1])
redis.call('PEXPIRE', KEYS[1], 180000)
return 0`;
const COOLDOWN = `
local clock = redis.call('TIME')
local now = clock[1] * 1000 + math.floor(clock[2] / 1000)
local untilAt = math.max(tonumber(redis.call('GET', KEYS[1]) or '0'), now + tonumber(ARGV[1]))
redis.call('SET', KEYS[1], untilAt, 'PX', untilAt - now)
return untilAt`;
const RENEW = `
if redis.call('ZSCORE', KEYS[1], ARGV[1]) == false then return 0 end
local clock = redis.call('TIME')
local now = clock[1] * 1000 + math.floor(clock[2] / 1000)
redis.call('ZADD', KEYS[1], now + 90000, ARGV[1])
redis.call('PEXPIRE', KEYS[1], 180000)
return 1`;

export interface PlayerProviderBudget {
    run<T>(
        provider: string,
        work: () => Promise<T>,
        signal?: AbortSignal,
    ): Promise<T>;
}
let activeBudget: PlayerProviderBudget | undefined;
export function setPlayerProviderBudget(budget: PlayerProviderBudget) {
    activeBudget = budget;
}
export function withPlayerProviderBudget<T>(
    provider: string,
    work: () => Promise<T>,
    signal?: AbortSignal,
): Promise<T> {
    if (!activeBudget)
        throw new ProviderSyncError(
            "failed",
            "Player provider budget is not initialized",
        );
    return activeBudget.run(provider, work, signal);
}

@Injectable()
export class PlayerProviderBudgetService
    implements PlayerProviderBudget, OnModuleInit
{
    constructor(
        @InjectQueue(PLAYER_PROVIDER_BUDGET_QUEUE)
        private readonly queue: Queue,
    ) {}
    onModuleInit() {
        setPlayerProviderBudget(this);
    }

    private keys(provider: string) {
        if (!["Steam", "PSN", "Xbox"].includes(provider))
            throw new Error("Invalid player provider");
        const prefix = `${this.queue.opts.prefix ?? "bull"}:${PLAYER_PROVIDER_BUDGET_QUEUE}:{${provider}}`;
        return { permits: `${prefix}:permits`, cooldown: `${prefix}:cooldown` };
    }

    async run<T>(
        provider: string,
        work: () => Promise<T>,
        signal?: AbortSignal,
    ): Promise<T> {
        const keys = this.keys(provider);
        const redis = await this.queue.client;
        const token = randomUUID();
        while (true) {
            if (signal?.aborted)
                throw new ProviderSyncError(
                    "failed",
                    "Player provider admission cancelled",
                );
            const waitMs = Number(
                await redis.eval(
                    ACQUIRE,
                    2,
                    keys.permits,
                    keys.cooldown,
                    token,
                ),
            );
            if (waitMs === 0) break;
            await new Promise<void>((resolve, reject) => {
                const abort = () => {
                    clearTimeout(timer);
                    reject(
                        new ProviderSyncError(
                            "failed",
                            "Player provider admission cancelled",
                        ),
                    );
                };
                const timer = setTimeout(
                    () => {
                        signal?.removeEventListener("abort", abort);
                        resolve();
                    },
                    Math.min(waitMs, 1000),
                );
                signal?.addEventListener("abort", abort, { once: true });
                if (signal?.aborted) abort();
            });
        }
        let renewalFailed = false;
        const timer = setInterval(() => {
            redis
                .eval(RENEW, 1, keys.permits, token)
                .then((renewed) => {
                    if (renewed !== 1) renewalFailed = true;
                })
                .catch(() => {
                    renewalFailed = true;
                });
        }, LEASE_MS / 3);
        try {
            if (signal?.aborted)
                throw new ProviderSyncError(
                    "failed",
                    "Player provider admission cancelled",
                );
            const result = await work();
            if (renewalFailed)
                throw new ProviderSyncError(
                    "failed",
                    "Player provider permit ownership lost",
                );
            return result;
        } catch (error) {
            if (
                error instanceof ProviderSyncError &&
                error.outcome === "throttled"
            ) {
                const delay = Math.max(
                    1,
                    Math.ceil(error.retryAfterMs ?? 60_000),
                );
                if (
                    !Number.isSafeInteger(delay) ||
                    !Number.isSafeInteger(Date.now() + delay)
                )
                    throw new ProviderSyncError(
                        "failed",
                        "Invalid provider retry delay",
                        error,
                    );
                await redis.eval(COOLDOWN, 1, keys.cooldown, delay);
            }
            throw error;
        } finally {
            clearInterval(timer);
            await redis.zrem(keys.permits, token);
        }
    }
}
