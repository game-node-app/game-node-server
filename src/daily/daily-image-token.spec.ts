import {
    signDailyImageToken,
    verifyDailyImageToken,
} from "./daily-image-token";

const secret = "test-secret";

describe("daily image tokens", () => {
    it("verifies what it signs", () => {
        for (const l of [0, 5, "full"] as const) {
            const payload = { p: 42, k: "artwork" as const, l };
            expect(
                verifyDailyImageToken(
                    signDailyImageToken(payload, secret),
                    secret,
                ),
            ).toEqual(payload);
        }
    });

    it("rejects tampered, foreign and malformed tokens", () => {
        const token = signDailyImageToken({ p: 42, k: "cover", l: 0 }, secret);
        const [body, signature] = token.split(".");
        const forgedBody = Buffer.from(
            JSON.stringify({ p: 42, k: "cover", l: "full" }),
        ).toString("base64url");
        const tamperedSignature =
            (signature[0] === "A" ? "B" : "A") + signature.slice(1);

        expect(
            verifyDailyImageToken(`${forgedBody}.${signature}`, secret),
        ).toBeNull();
        expect(
            verifyDailyImageToken(`${body}.${tamperedSignature}`, secret),
        ).toBeNull();
        expect(verifyDailyImageToken(token, "other-secret")).toBeNull();
        expect(verifyDailyImageToken("garbage", secret)).toBeNull();
        expect(verifyDailyImageToken(`${token}.extra`, secret)).toBeNull();
    });

    it("rejects a signed payload with an out-of-range level", () => {
        expect(
            verifyDailyImageToken(
                signDailyImageToken({ p: 1, k: "cover", l: 6 }, secret),
                secret,
            ),
        ).toBeNull();
    });

    it("verifies a practice round source and keeps puzzle tokens working", () => {
        const round = {
            p: "b3f1c2d4-0000-4000-8000-000000000000",
            k: "cover" as const,
            l: 0,
            s: "r" as const,
        };
        expect(
            verifyDailyImageToken(signDailyImageToken(round, secret), secret),
        ).toEqual(round);

        const puzzle = { p: 42, k: "cover" as const, l: "full" as const };
        expect(
            verifyDailyImageToken(signDailyImageToken(puzzle, secret), secret),
        ).toEqual(puzzle);

        // The id type must match the source, and the source must be known.
        expect(
            verifyDailyImageToken(
                signDailyImageToken({ p: round.p, k: "cover", l: 0 }, secret),
                secret,
            ),
        ).toBeNull();
        expect(
            verifyDailyImageToken(
                signDailyImageToken(
                    { p: 42, k: "cover", l: 0, s: "r" },
                    secret,
                ),
                secret,
            ),
        ).toBeNull();
        expect(
            verifyDailyImageToken(
                signDailyImageToken(
                    { p: 42, k: "cover", l: 0, s: "x" } as any,
                    secret,
                ),
                secret,
            ),
        ).toBeNull();
    });
});
