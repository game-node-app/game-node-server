import Redis from "ioredis";
import { releaseSlot, tryAcquireSlot, waitForSlot } from "./redis-semaphore";

process.env.REDIS_URL ??= "redis://localhost:6379";
const { hostname, port } = new URL(process.env.REDIS_URL);

describe("redis semaphore", () => {
    const redis = new Redis({ host: hostname, port: Number(port) });
    const key = `test:redis-semaphore:${process.pid}`;

    beforeEach(() => redis.del(key));
    afterAll(async () => {
        await redis.del(key);
        redis.disconnect();
    });

    it("hands out at most max slots and frees them on release", async () => {
        const a = await tryAcquireSlot(redis, key, 2, 60_000);
        const b = await tryAcquireSlot(redis, key, 2, 60_000);
        expect(a && b).toBeTruthy();
        expect(await tryAcquireSlot(redis, key, 2, 60_000)).toBeNull();

        const waiting = waitForSlot(redis, key, 2, 60_000, {
            timeoutMs: 2_000,
            pollMs: 10,
        });
        await releaseSlot(redis, key, a!);
        await expect(waiting).resolves.toEqual(expect.any(String));
    });

    it("frees slots held past staleMs, so a dead process can't leak them", async () => {
        await tryAcquireSlot(redis, key, 1, 50);
        expect(await tryAcquireSlot(redis, key, 1, 50)).toBeNull();
        await new Promise((r) => setTimeout(r, 60));
        expect(await tryAcquireSlot(redis, key, 1, 50)).toEqual(
            expect.any(String),
        );
    });

    it("gives up after timeoutMs, or as soon as the caller is gone", async () => {
        await tryAcquireSlot(redis, key, 1, 60_000);
        await expect(
            waitForSlot(redis, key, 1, 60_000, { timeoutMs: 30, pollMs: 10 }),
        ).resolves.toBeNull();
        await expect(
            waitForSlot(redis, key, 1, 60_000, {
                timeoutMs: 60_000,
                pollMs: 10,
                cancelled: () => true,
            }),
        ).resolves.toBeNull();
    });

    it("fails open when Redis is unreachable", async () => {
        const down = new Redis({
            port: 1,
            enableOfflineQueue: false,
            maxRetriesPerRequest: 0,
            lazyConnect: true,
        });
        await expect(tryAcquireSlot(down, key, 1, 1_000)).resolves.toEqual(
            expect.any(String),
        );
        down.disconnect();
    });
});
