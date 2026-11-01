import type { Queue } from "bullmq";

export const TOKEN_LOCK_MS = 60_000;

/** Redis lock (SET NX PX) that serializes token refreshes for one connection. */
export async function acquireTokenLock(
    queue: Queue,
    lockKey: string,
    token: string,
    maxWaitMs = 10_000,
) {
    const redis = await queue.client;
    const deadline = Date.now() + maxWaitMs;
    do {
        if (await redis.set(lockKey, token, "PX", TOKEN_LOCK_MS, "NX"))
            return true;
        await new Promise((resolve) => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    return false;
}

export async function renewTokenLock(
    queue: Queue,
    lockKey: string,
    token: string,
) {
    const redis = await queue.client;
    return redis.eval(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) end; return 0",
        1,
        lockKey,
        token,
        TOKEN_LOCK_MS,
    );
}

export async function releaseTokenLock(
    queue: Queue,
    lockKey: string,
    token: string,
) {
    const redis = await queue.client;
    await redis.eval(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end; return 0",
        1,
        lockKey,
        token,
    );
}
