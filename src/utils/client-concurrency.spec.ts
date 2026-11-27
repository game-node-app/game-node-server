import { EventEmitter } from "node:events";

// Read when client-ip loads, so it must be set before the import below.
process.env.TRUSTED_FORWARDER_IPS = "10.0.0.1";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
    limitConcurrencyPerClient,
    MAX_ACTIVE_PER_CLIENT,
    MAX_QUEUED_PER_CLIENT,
} = require("./client-concurrency") as typeof import("./client-concurrency");

function request(ip: string) {
    const res = Object.assign(new EventEmitter(), {
        statusCode: 200,
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        json: jest.fn(),
    });
    const next = jest.fn();
    return {
        req: { headers: { "cf-connecting-ip": ip } } as never,
        res,
        next,
        finish: () => res.emit("close"),
    };
}

describe("limitConcurrencyPerClient", () => {
    it("runs a few at a time per client, queues the next ones and rejects past the queue", () => {
        const limit = limitConcurrencyPerClient();
        const burst = Array.from(
            { length: MAX_ACTIVE_PER_CLIENT + MAX_QUEUED_PER_CLIENT + 1 },
            () => request("1.1.1.1"),
        );
        for (const r of burst) limit(r.req, r.res as never, r.next);

        const started = () => burst.filter((r) => r.next.mock.calls.length);
        expect(started()).toHaveLength(MAX_ACTIVE_PER_CLIENT);
        expect(burst.at(-1)!.res.statusCode).toBe(429);

        // Another client is unaffected.
        const other = request("2.2.2.2");
        limit(other.req, other.res as never, other.next);
        expect(other.next).toHaveBeenCalled();

        // A queued client that disconnects leaves the line; a finished one lets the next queued start.
        const queued = burst[MAX_ACTIVE_PER_CLIENT];
        queued.finish();
        burst[0].finish();
        expect(queued.next).not.toHaveBeenCalled();
        expect(burst[MAX_ACTIVE_PER_CLIENT + 1].next).toHaveBeenCalled();
        expect(started()).toHaveLength(MAX_ACTIVE_PER_CLIENT + 1);
    });

    it("gives a trusted forwarder more room", () => {
        const limit = limitConcurrencyPerClient();
        const burst = Array.from({ length: MAX_ACTIVE_PER_CLIENT * 2 }, () =>
            request("10.0.0.1"),
        );
        for (const r of burst) limit(r.req, r.res as never, r.next);
        expect(burst.every((r) => r.next.mock.calls.length)).toBe(true);
    });
});
