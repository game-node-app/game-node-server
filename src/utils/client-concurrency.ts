import type { NextFunction, Request, RequestHandler, Response } from "express";
import {
    clientIp,
    isTrustedForwarder,
    TRUSTED_FORWARDER_MULTIPLIER,
} from "./client-ip";

/** Requests one client may have running at once; the rest wait in line. */
export const MAX_ACTIVE_PER_CLIENT = 8;
/** Requests one client may have waiting; past this it gets 429 right away. */
export const MAX_QUEUED_PER_CLIENT = 32;

interface ClientSlot {
    active: number;
    queue: Array<() => void>;
}

/**
 * Caps the requests a single client has in flight, so a burst of expensive requests from one IP can't take
 * every DB connection or the whole event loop. The rate limit counts requests, this counts concurrency.
 * shortcut: per process, so with API_PROCESSES > 1 the cap is per process; move to Redis if that matters.
 */
export function limitConcurrencyPerClient(): RequestHandler {
    const slots = new Map<string, ClientSlot>();

    return (req: Request, res: Response, next: NextFunction) => {
        const key = clientIp(req);
        const multiplier = isTrustedForwarder(req)
            ? TRUSTED_FORWARDER_MULTIPLIER
            : 1;
        let slot = slots.get(key);
        if (!slot) {
            slot = { active: 0, queue: [] };
            slots.set(key, slot);
        }
        const current = slot;

        // The finished request's place goes straight to the next one in line.
        const release = () => {
            const waiter = current.queue.shift();
            if (waiter) waiter();
            else if (--current.active === 0) slots.delete(key);
        };
        const start = () => {
            res.once("close", release);
            next();
        };

        if (current.active < MAX_ACTIVE_PER_CLIENT * multiplier) {
            current.active++;
            return start();
        }
        if (current.queue.length >= MAX_QUEUED_PER_CLIENT * multiplier) {
            res.status(429).json({
                statusCode: 429,
                message: "Too many concurrent requests",
            });
            return;
        }
        current.queue.push(start);
        // A client that gives up while waiting leaves the line.
        res.once("close", () => {
            const index = current.queue.indexOf(start);
            if (index !== -1) current.queue.splice(index, 1);
        });
    };
}
