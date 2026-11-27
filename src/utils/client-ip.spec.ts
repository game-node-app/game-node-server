import { clientIp, dropSpoofedClientIp } from "./client-ip";

function through(headers: Record<string, string>, remoteAddress = "10.0.1.6") {
    const req = { headers, socket: { remoteAddress } } as never;
    dropSpoofedClientIp(req, {} as never, () => undefined);
    return clientIp(req);
}

describe("client IP", () => {
    it("trusts cf-connecting-ip when Traefik saw a Cloudflare peer", () => {
        expect(
            through({
                "x-real-ip": "172.70.1.2",
                "cf-connecting-ip": "198.51.100.1",
            }),
        ).toBe("198.51.100.1");
        expect(
            through({
                "x-real-ip": "2606:4700::1",
                "cf-connecting-ip": "198.51.100.1",
            }),
        ).toBe("198.51.100.1");
    });

    it("ignores cf-connecting-ip from anyone reaching the origin directly", () => {
        expect(
            through({
                "x-real-ip": "203.0.113.7",
                "cf-connecting-ip": "130.254.47.92",
            }),
        ).toBe("203.0.113.7");
        expect(
            through(
                { "cf-connecting-ip": "130.254.47.92" },
                "::ffff:203.0.113.8",
            ),
        ).toBe("203.0.113.8");
    });
});
