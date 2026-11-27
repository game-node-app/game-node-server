import type { Request } from "express";

/** Our own servers (the web app's SSR), which call the API on behalf of every visitor from one IP. */
const TRUSTED_FORWARDER_IPS = new Set(
    (process.env.TRUSTED_FORWARDER_IPS ?? "")
        .split(",")
        .map((ip) => ip.trim())
        .filter(Boolean),
);

/** How many clients' worth of limits a trusted forwarder gets. */
export const TRUSTED_FORWARDER_MULTIPLIER = 10;

/** The origin only receives Cloudflare traffic, so req.ip is always the proxy. */
export function clientIp(req: Request): string {
    return (
        (req.headers["cf-connecting-ip"] as string | undefined) ??
        req.ip ??
        "unknown"
    );
}

export function isTrustedForwarder(req: Request): boolean {
    return TRUSTED_FORWARDER_IPS.has(clientIp(req));
}
