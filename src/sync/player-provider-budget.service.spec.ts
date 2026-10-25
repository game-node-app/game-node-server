import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import {
    PLAYER_PROVIDER_BUDGET_QUEUE,
    PlayerProviderBudgetService,
} from "./player-provider-budget.service";
import { ProviderSyncError } from "./provider-sync.error";
import { ConnectionProviderRegistry } from "../connection/connection-provider.registry";

describe("PlayerProviderBudgetService provider validation and budget scoping", () => {
    let queue: any;
    let registry: ConnectionProviderRegistry;
    let service: PlayerProviderBudgetService;

    beforeEach(() => {
        queue = {
            opts: { prefix: "test-bull" },
            client: Promise.resolve({}),
        };
        registry = new ConnectionProviderRegistry();
        service = new PlayerProviderBudgetService(queue as any, registry);
    });

    it("accepts registered providers and valid sub-scopes", () => {
        expect(service.keys("Steam")).toEqual({
            permits: "test-bull:player-provider-budget:{Steam}:permits",
            cooldown: "test-bull:player-provider-budget:{Steam}:cooldown",
        });
        expect(service.keys("PSN")).toEqual({
            permits: "test-bull:player-provider-budget:{PSN}:permits",
            cooldown: "test-bull:player-provider-budget:{PSN}:cooldown",
        });
        expect(service.keys("Xbox")).toEqual({
            permits: "test-bull:player-provider-budget:{Xbox}:permits",
            cooldown: "test-bull:player-provider-budget:{Xbox}:cooldown",
        });
        expect(service.keys("Xbox:catalog")).toEqual({
            permits: "test-bull:player-provider-budget:{Xbox:catalog}:permits",
            cooldown:
                "test-bull:player-provider-budget:{Xbox:catalog}:cooldown",
        });
        expect(service.keys("Xbox:user:2535470001")).toEqual({
            permits:
                "test-bull:player-provider-budget:{Xbox:user:2535470001}:permits",
            cooldown:
                "test-bull:player-provider-budget:{Xbox:user:2535470001}:cooldown",
        });
    });

    it("rejects unregistered providers", () => {
        expect(() => service.keys("Nintendo")).toThrow(
            "Invalid player provider",
        );
        expect(() => service.keys("Unknown")).toThrow(
            "Invalid player provider",
        );
    });

    it("rejects invalid Xbox sub-scopes", () => {
        expect(() => service.keys("Xbox:invalid")).toThrow(
            "Invalid player provider scope",
        );
        expect(() => service.keys("Xbox:user:")).toThrow(
            "Missing sourceUserId for user-scoped player provider",
        );
    });

    it("distinct users produce distinct permit and cooldown keys", () => {
        const user1Keys = service.keys("Xbox:user:user-1");
        const user2Keys = service.keys("Xbox:user:user-2");
        expect(user1Keys.permits).not.toEqual(user2Keys.permits);
        expect(user1Keys.cooldown).not.toEqual(user2Keys.cooldown);
    });
});

const redisDescribe = process.env.PLAYER_IMPORT_TEST_REDIS_PORT
    ? describe
    : describe.skip;
redisDescribe("shared player provider admission (real Redis)", () => {
    const prefix = `player-provider-test-${randomUUID()}`;
    let queue: Queue;
    let first: PlayerProviderBudgetService;
    let second: PlayerProviderBudgetService;
    beforeAll(() => {
        queue = new Queue(PLAYER_PROVIDER_BUDGET_QUEUE, {
            prefix,
            connection: {
                host: "127.0.0.1",
                port: Number(process.env.PLAYER_IMPORT_TEST_REDIS_PORT),
                maxRetriesPerRequest: null,
            },
        });
        first = new PlayerProviderBudgetService(
            queue,
            new ConnectionProviderRegistry(),
        );
        second = new PlayerProviderBudgetService(
            queue,
            new ConnectionProviderRegistry(),
        );
    });
    afterEach(async () => {
        const redis = await queue.client;
        const keys = await redis.keys(`${prefix}:*`);
        if (keys.length) await redis.del(...keys);
    });
    afterAll(async () => {
        await queue.close();
    });

    it("shares one injected 429 cooldown across two service instances", async () => {
        await expect(
            first.run("Xbox", async () => {
                throw new ProviderSyncError(
                    "throttled",
                    "fixture",
                    undefined,
                    429,
                    300,
                );
            }),
        ).rejects.toMatchObject({ outcome: "throttled" });
        const leaf = jest.fn().mockResolvedValue("ok");
        const start = Date.now();
        await expect(second.run("Xbox", leaf)).resolves.toBe("ok");
        expect(Date.now() - start).toBeGreaterThanOrEqual(250);
        expect(leaf).toHaveBeenCalledTimes(1);
    });

    it("isolates cooldowns between different Xbox user scopes", async () => {
        await expect(
            first.run("Xbox:user:xuid-1", async () => {
                throw new ProviderSyncError(
                    "throttled",
                    "fixture",
                    undefined,
                    429,
                    3000,
                );
            }),
        ).rejects.toMatchObject({ outcome: "throttled" });

        // User 2 should NOT be throttled by user 1's 429 cooldown
        const leaf = jest.fn().mockResolvedValue("user-2-ok");
        const start = Date.now();
        await expect(second.run("Xbox:user:xuid-2", leaf)).resolves.toBe(
            "user-2-ok",
        );
        expect(Date.now() - start).toBeLessThan(1000);
        expect(leaf).toHaveBeenCalledTimes(1);
    });

    it("limits simultaneous leaf calls across replicas", async () => {
        let active = 0;
        let maximum = 0;
        const work = async () => {
            active++;
            maximum = Math.max(active, maximum);
            await new Promise((r) => setTimeout(r, 30));
            active--;
        };
        await Promise.all(
            Array.from({ length: 8 }, (_, i) =>
                (i % 2 ? first : second).run("PSN", work),
            ),
        );
        expect(maximum).toBe(2);
    });

    it("keeps different providers independent", async () => {
        const redis = await queue.client;
        const key = `${prefix}:${PLAYER_PROVIDER_BUDGET_QUEUE}:{PSN}:permits`;
        await redis.zadd(
            key,
            Date.now() + 90000,
            "other-a",
            Date.now() + 90000,
            "other-b",
        );
        await expect(
            second.run("Xbox", async () => "independent"),
        ).resolves.toBe("independent");
        expect(await redis.zcard(key)).toBe(2);
    });

    it("recovers abandoned leases without deleting another instance's permit", async () => {
        const redis = await queue.client;
        const key = `${prefix}:${PLAYER_PROVIDER_BUDGET_QUEUE}:{Steam}:permits`;
        await redis.zadd(
            key,
            Date.now() - 1,
            "dead-a",
            Date.now() - 1,
            "dead-b",
        );
        await expect(
            second.run("Steam", async () => "recovered"),
        ).resolves.toBe("recovered");
        expect(await redis.zcard(key)).toBe(0);
    });

    it("cancels an admission wait without calling the provider", async () => {
        const redis = await queue.client;
        const key = `${prefix}:${PLAYER_PROVIDER_BUDGET_QUEUE}:{PSN}:permits`;
        await redis.zadd(
            key,
            Date.now() + 90000,
            "other-a",
            Date.now() + 90000,
            "other-b",
        );
        const controller = new AbortController();
        const leaf = jest.fn();
        const pending = first.run("PSN", leaf, controller.signal);
        controller.abort();
        await expect(pending).rejects.toThrow("admission cancelled");
        expect(leaf).not.toHaveBeenCalled();
        expect(await redis.zcard(key)).toBe(2);
    });

    it("admits sequential leaf calls from nested orchestration without retaining a parent permit", async () => {
        const result = await Promise.all(
            [first, second, first].map(async (service) => {
                const a = await service.run("Xbox", async () => 1);
                const b = await service.run("Xbox", async () => 2);
                return a + b;
            }),
        );
        expect(result).toEqual([3, 3, 3]);
    });
});
