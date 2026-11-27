import type { NextFunction, Request, Response } from "express";
import { BlockList, isIP } from "node:net";

/** Our own servers (the web app's SSR), which call the API on behalf of every visitor from one IP. */
const TRUSTED_FORWARDER_IPS = new Set(
    (process.env.TRUSTED_FORWARDER_IPS ?? "")
        .split(",")
        .map((ip) => ip.trim())
        .filter(Boolean),
);

/** How many clients' worth of limits a trusted forwarder gets. */
export const TRUSTED_FORWARDER_MULTIPLIER = 10;

// shortcut: hardcoded from https://www.cloudflare.com/ips/ (also in the VPS firewall), update both if Cloudflare adds ranges.
const CLOUDFLARE_RANGES = [
    "173.245.48.0/20",
    "103.21.244.0/22",
    "103.22.200.0/22",
    "103.31.4.0/22",
    "141.101.64.0/18",
    "108.162.192.0/18",
    "190.93.240.0/20",
    "188.114.96.0/20",
    "197.234.240.0/22",
    "198.41.128.0/17",
    "162.158.0.0/15",
    "104.16.0.0/13",
    "104.24.0.0/14",
    "172.64.0.0/13",
    "131.0.72.0/22",
    "2400:cb00::/32",
    "2606:4700::/32",
    "2803:f800::/32",
    "2405:b500::/32",
    "2405:8100::/32",
    "2a06:98c0::/29",
    "2c0f:f248::/32",
];
const CLOUDFLARE = new BlockList();
for (const range of CLOUDFLARE_RANGES) {
    const [network, prefix] = range.split("/");
    CLOUDFLARE.addSubnet(
        network,
        Number(prefix),
        isIP(network) === 6 ? "ipv6" : "ipv4",
    );
}

/** Who opened the connection to Traefik, which sets x-real-ip and overwrites any value the client sent. */
function peerIp(req: Request): string | undefined {
    const ip =
        (req.headers["x-real-ip"] as string | undefined) ??
        req.socket?.remoteAddress;
    return ip?.replace(/^::ffff:/, "");
}

function isCloudflare(ip: string | undefined): boolean {
    const version = ip ? isIP(ip) : 0;
    return (
        version !== 0 && CLOUDFLARE.check(ip!, version === 6 ? "ipv6" : "ipv4")
    );
}

/**
 * Anyone reaching the origin directly can send any cf-connecting-ip, so the header only counts when the
 * connection came from Cloudflare. Runs first, so the limits and Better Auth all see the same client IP.
 */
export function dropSpoofedClientIp(
    req: Request,
    _res: Response,
    next: NextFunction,
) {
    if (!isCloudflare(peerIp(req))) delete req.headers["cf-connecting-ip"];
    next();
}

export function clientIp(req: Request): string {
    return (
        (req.headers["cf-connecting-ip"] as string | undefined) ??
        peerIp(req) ??
        req.ip ??
        "unknown"
    );
}

export function isTrustedForwarder(req: Request): boolean {
    return TRUSTED_FORWARDER_IPS.has(clientIp(req));
}
