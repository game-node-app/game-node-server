import { Logger } from "@nestjs/common";
import Redis from "ioredis";
import { randomUUID } from "node:crypto";
import { getRedisConfig } from "./getRedisConfig";

const logger = new Logger("RedisSemaphore");

/**
 * Slots are members of a sorted set scored by when they were taken. Holders older than staleMs are dropped first,
 * so a process that dies holding slots can't leak them; then a slot is taken if fewer than max are held.
 */
const ACQUIRE_SCRIPT = `
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", tonumber(ARGV[1]) - tonumber(ARGV[2]))
if redis.call("ZCARD", KEYS[1]) < tonumber(ARGV[3]) then
    redis.call("ZADD", KEYS[1], ARGV[1], ARGV[4])
    redis.call("PEXPIRE", KEYS[1], ARGV[2])
    return 1
end
return 0
`;

let client: Redis | undefined;

/** One connection per process. Offline commands fail at once, so the limits fail open instead of hanging requests. */
export function limiterRedis(): Redis {
    const { host, port } = getRedisConfig();
    client ??= new Redis({
        host,
        port,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 0,
        commandTimeout: 500,
    });
    return client;
}

let lastWarnedAt = 0;
function warnFailOpen(error: unknown) {
    if (Date.now() - lastWarnedAt < 60_000) return;
    lastWarnedAt = Date.now();
    logger.warn(
        `Limiter Redis unavailable, letting requests through: ${error}`,
    );
}

/** A slot id when one of the max slots is free, else null. Redis errors count as a free slot. */
export async function tryAcquireSlot(
    redis: Redis,
    key: string,
    max: number,
    staleMs: number,
): Promise<string | null> {
    const id = randomUUID();
    try {
        const taken = await redis.eval(
            ACQUIRE_SCRIPT,
            1,
            key,
            Date.now(),
            staleMs,
            max,
            id,
        );
        return taken === 1 ? id : null;
    } catch (error) {
        warnFailOpen(error);
        return id;
    }
}

export async function releaseSlot(redis: Redis, key: string, id: string) {
    try {
        await redis.zrem(key, id);
    } catch (error) {
        // The slot expires after staleMs anyway.
        warnFailOpen(error);
    }
}

/** Polls for a slot until timeoutMs passes or cancelled() says the caller is gone; null when none came free. */
export async function waitForSlot(
    redis: Redis,
    key: string,
    max: number,
    staleMs: number,
    options: { timeoutMs: number; pollMs: number; cancelled?: () => boolean },
): Promise<string | null> {
    const deadline = Date.now() + options.timeoutMs;
    while (!options.cancelled?.()) {
        const slot = await tryAcquireSlot(redis, key, max, staleMs);
        if (slot) return slot;
        if (Date.now() >= deadline) return null;
        await new Promise((resolve) => setTimeout(resolve, options.pollMs));
    }
    return null;
}
