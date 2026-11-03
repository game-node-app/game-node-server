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
});
