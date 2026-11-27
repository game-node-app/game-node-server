import { EventEmitter } from "node:events";
import Redis from "ioredis";

// Read when client-ip loads, so it must be set before the import below.
process.env.TRUSTED_FORWARDER_IPS = "10.0.0.1";
process.env.REDIS_URL ??= "redis://localhost:6379";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
    limitConcurrencyPerClient,
    MAX_ACTIVE_PER_CLIENT,
    MAX_QUEUED_PER_CLIENT,
} = require("./client-concurrency") as typeof import("./client-concurrency");

const { hostname, port } = new URL(process.env.REDIS_URL);
const redis = new Redis({ host: hostname, port: Number(port) });
const IPS = ["192.0.2.1", "192.0.2.2", "10.0.0.1"];
const settle = () => new Promise((r) => setTimeout(r, 150));

function request(ip: string) {
    const res = Object.assign(new EventEmitter(), {
        statusCode: 200,
        headersSent: false,
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        json: jest.fn(),
        end() {
            this.headersSent = true;
            return this;
        },
    });
    const next = jest.fn();
    return {
        req: { headers: { "cf-connecting-ip": ip } } as never,
        res,
        next,
        finish: () => {
            res.end();
            res.emit("close");
        },
        hangUp: () => res.emit("close"),
    };
}

describe("limitConcurrencyPerClient", () => {
    const clear = () =>
        redis.del(
            ...IPS.flatMap((ip) => [
                `client-concurrency:active:${ip}`,
                `client-concurrency:waiting:${ip}`,
            ]),
        );
    beforeEach(clear);
    afterAll(async () => {
        await clear();
        redis.disconnect();
    });

    it("runs a few at a time per client, queues the next ones and rejects past the queue", async () => {
        const limit = limitConcurrencyPerClient(redis);
        const burst = Array.from(
            { length: MAX_ACTIVE_PER_CLIENT + MAX_QUEUED_PER_CLIENT + 1 },
            () => request("192.0.2.1"),
        );
        // In order, so the first ones are the ones that get slots.
        for (const r of burst.slice(0, MAX_ACTIVE_PER_CLIENT))
            await limit(r.req, r.res as never, r.next);
        for (const r of burst.slice(MAX_ACTIVE_PER_CLIENT))
            void limit(r.req, r.res as never, r.next);
        await settle();

        const started = () => burst.filter((r) => r.next.mock.calls.length);
        expect(started()).toHaveLength(MAX_ACTIVE_PER_CLIENT);
        expect(burst.filter((r) => r.res.statusCode === 429)).toHaveLength(1);

        // Another client is unaffected.
        const other = request("192.0.2.2");
        await limit(other.req, other.res as never, other.next);
        expect(other.next).toHaveBeenCalled();

        // A finished request lets exactly one waiting request start.
        burst[0].finish();
        await settle();
        expect(started()).toHaveLength(MAX_ACTIVE_PER_CLIENT + 1);

        for (const r of burst) r.finish();
    });

    it("keeps a slot while the handler still runs after the client hangs up", async () => {
        const limit = limitConcurrencyPerClient(redis);
        const running = Array.from({ length: MAX_ACTIVE_PER_CLIENT }, () =>
            request("192.0.2.1"),
        );
        for (const r of running) await limit(r.req, r.res as never, r.next);
        for (const r of running) r.hangUp();

        const next = request("192.0.2.1");
        void limit(next.req, next.res as never, next.next);
        await settle();
        expect(next.next).not.toHaveBeenCalled();

        // The handler answers, even to a gone client: now the slot frees.
        running[0].res.end();
        await settle();
        expect(next.next).toHaveBeenCalled();

        for (const r of [...running, next]) r.finish();
    });

    it("gives a trusted forwarder more room", async () => {
        const limit = limitConcurrencyPerClient(redis);
        const burst = Array.from({ length: MAX_ACTIVE_PER_CLIENT * 2 }, () =>
            request("10.0.0.1"),
        );
        await Promise.all(
            burst.map((r) => limit(r.req, r.res as never, r.next)),
        );
        expect(burst.every((r) => r.next.mock.calls.length)).toBe(true);
        for (const r of burst) r.finish();
    });
});
