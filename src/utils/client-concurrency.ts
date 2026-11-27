import type { NextFunction, Request, RequestHandler, Response } from "express";
import type Redis from "ioredis";
import {
    clientIp,
    isTrustedForwarder,
    TRUSTED_FORWARDER_MULTIPLIER,
} from "./client-ip";
import {
    limiterRedis,
    releaseSlot,
    tryAcquireSlot,
    waitForSlot,
} from "./redis-semaphore";

/** Requests one client may have running at once, across every API process; the rest wait in line. */
export const MAX_ACTIVE_PER_CLIENT = 8;
/** Requests one client may have waiting; past this it gets 429 right away. */
export const MAX_QUEUED_PER_CLIENT = 32;
/** How long a request waits for a slot before giving up with 429. */
export const MAX_WAIT_MS = 30_000;
/** A slot held longer than this is presumed leaked (its process died) and freed; Cloudflare gives up at 100s. */
const ACTIVE_STALE_MS = 120_000;
const POLL_MS = 50;

function tooMany(res: Response) {
    res.status(429).json({
        statusCode: 429,
        message: "Too many concurrent requests",
    });
}

/**
 * Caps the requests a single client has in flight, so a burst of expensive requests from one IP can't take
 * every DB connection or the whole event loop. The rate limit counts requests, this counts concurrency.
 * Slots live in Redis, so the cap holds across API processes and containers.
 */
export function limitConcurrencyPerClient(
    redis: Redis = limiterRedis(),
): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) =>
        admit(redis, req, res, next).catch(next);
}

async function admit(
    redis: Redis,
    req: Request,
    res: Response,
    next: NextFunction,
) {
    const ip = clientIp(req);
    const multiplier = isTrustedForwarder(req)
        ? TRUSTED_FORWARDER_MULTIPLIER
        : 1;
    const activeKey = `client-concurrency:active:${ip}`;
    const maxActive = MAX_ACTIVE_PER_CLIENT * multiplier;
    let closed = false;
    res.once("close", () => (closed = true));

    let slot = await tryAcquireSlot(
        redis,
        activeKey,
        maxActive,
        ACTIVE_STALE_MS,
    );
    if (!slot) {
        const waitingKey = `client-concurrency:waiting:${ip}`;
        const ticket = await tryAcquireSlot(
            redis,
            waitingKey,
            MAX_QUEUED_PER_CLIENT * multiplier,
            MAX_WAIT_MS + 5_000,
        );
        if (!ticket) return tooMany(res);
        try {
            slot = await waitForSlot(
                redis,
                activeKey,
                maxActive,
                ACTIVE_STALE_MS,
                // A client that gives up while waiting leaves the line.
                {
                    timeoutMs: MAX_WAIT_MS,
                    pollMs: POLL_MS,
                    cancelled: () => closed,
                },
            );
        } finally {
            await releaseSlot(redis, waitingKey, ticket);
        }
        if (!slot) return closed ? undefined : tooMany(res);
    }

    const acquired = slot;
    if (closed) return releaseSlot(redis, activeKey, acquired);
    let released = false;
    const release = () => {
        if (released) return;
        released = true;
        void releaseSlot(redis, activeKey, acquired);
    };
    // Hanging up doesn't stop the handler, so the slot is held until the response is written, not until "close";
    // otherwise a client could abort and resend to run any number of queries. A handler that never answers frees it after ACTIVE_STALE_MS.
    const end = res.end;
    res.end = function (this: Response, ...args: Parameters<Response["end"]>) {
        release();
        return end.apply(this, args);
    } as Response["end"];
    // A streamed response (headers already sent) may never end once the client is gone.
    res.once("close", () => res.headersSent && release());
    next();
}
