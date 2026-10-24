import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import { randomUUID } from "node:crypto";
import { IgdbOutboundBudgetService } from "../../src/sync/igdb/catalog/igdb-outbound-budget.service";
import { testEnvironment } from "./helpers/test-environment";

describe("shared local Redis outbound budget", () => {
    const settings = testEnvironment(process.env);
    const prefix = `${settings.prefix}-${randomUUID()}`;
    let queues: Queue[];
    let services: IgdbOutboundBudgetService[];
    beforeAll(async () => {
        queues = [0, 1].map(
            () =>
                new Queue("outbound-fixture", {
                    connection: settings.redis,
                    prefix,
                }),
        );
        const config = {
            getOrThrow: (key: string) =>
                key === "TWITCH_CLIENT_ID"
                    ? "fixture-client"
                    : "fixture-secret",
        } as ConfigService;
        services = queues.map(
            (queue) => new IgdbOutboundBudgetService(queue, config),
        );
        await Promise.all(queues.map((queue) => queue.waitUntilReady()));
    });
    afterEach(async () => {
        const redis = await queues[0].client;
        await redis.del(
            `${services[0].namespace}:starts`,
            `${services[0].namespace}:permits`,
        );
    });
    afterAll(async () => {
        await Promise.all(queues.map((queue) => queue.close()));
    });

    it("combines two instances into four starts per rolling second and eight in flight", async () => {
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        let allStarted!: () => void;
        const eightStarted = new Promise<void>((resolve) => {
            allStarted = resolve;
        });
        const times: number[] = [];
        let active = 0;
        let maximum = 0;
        const first = Array.from({ length: 8 }, (_, index) =>
            services[index % 2].run(async () => {
                const clock = await (await queues[0].client).time();
                times.push(
                    Number(clock[0]) * 1000 +
                        Math.floor(Number(clock[1]) / 1000),
                );
                maximum = Math.max(maximum, ++active);
                if (times.length === 8) allStarted();
                await held;
                active--;
            }),
        );
        let ninthStarted = false;
        let ninth: Promise<void> | undefined;
        try {
            await eightStarted;
            ninth = services[0].run(async () => {
                ninthStarted = true;
            });
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(ninthStarted).toBe(false);
            expect(maximum).toBe(8);
            expect(
                await (
                    await queues[0].client
                ).zcard(`${services[0].namespace}:permits`),
            ).toBe(8);
            times.sort((a, b) => a - b);
            for (let i = 4; i < times.length; i++)
                expect(times[i] - times[i - 4]).toBeGreaterThanOrEqual(990);
        } finally {
            release();
            await Promise.allSettled(first);
            if (ninth) await ninth;
        }
        expect(
            await (
                await queues[0].client
            ).zcard(`${services[0].namespace}:permits`),
        ).toBe(0);
        expect(services[0].namespace).toBe(services[1].namespace);
        expect(services[0].namespace).not.toContain("fixture-secret");
    });

    it("releases failed callers and recovers expired crash permits", async () => {
        await expect(
            services[0].run(async () => {
                throw new Error("fixture failure");
            }),
        ).rejects.toThrow("fixture failure");
        const redis = await queues[0].client;
        expect(await redis.zcard(`${services[0].namespace}:permits`)).toBe(0);
        for (let i = 0; i < 8; i++)
            await redis.zadd(
                `${services[0].namespace}:permits`,
                1,
                `expired-${i}`,
            );
        const permit = await services[1].tryAcquire();
        expect(permit).not.toBeNull();
        expect(await redis.zcard(`${services[0].namespace}:permits`)).toBe(1);
        await services[1].release(permit!);
    });
});
