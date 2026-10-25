import { inspect } from "node:util";
import {
    providerCall,
    providerFailure,
    ProviderSyncError,
} from "./provider-sync.error";

describe("provider failures", () => {
    it.each([
        [401, "unavailable"],
        [403, "unavailable"],
        [429, "throttled"],
        [404, "failed"],
        [500, "failed"],
    ])("classifies explicit status %s as %s", (status, outcome) => {
        const cause = {
            response: { status, headers: { "retry-after": "30" } },
            config: { headers: { Authorization: "secret" } },
        };
        const error = providerFailure("Xbox", cause);
        expect(error).toMatchObject({
            outcome,
            status,
            retryAfterMs: 30000,
            cause,
        });
        expect(JSON.stringify(error)).not.toContain("secret");
        expect(inspect(error)).not.toContain("secret");
    });

    it("does not infer PSN privacy, throttling, or unsupported status from opaque error text/codes", () => {
        for (const cause of [
            new Error("private 429 no trophies"),
            { error: { code: 429, message: "secret" } },
        ]) {
            expect(providerFailure("PSN", cause)).toMatchObject({
                outcome: "failed",
                cause,
            });
        }
    });

    it("retains explicit incomplete/unsupported outcomes and cause", async () => {
        for (const outcome of ["incomplete", "unsupported", "reauth_required"] as const) {
            const error = new ProviderSyncError(outcome, "safe error");
            await expect(
                providerCall("Steam", async () => {
                    throw error;
                }),
            ).rejects.toBe(error);
            expect(error.outcome).toBe(outcome);
        }
    });

    it("does not convert a failed request into an empty result", async () => {
        const cause = new Error("token=secret");
        await expect(
            providerCall("PSN", async () => {
                throw cause;
            }),
        ).rejects.toMatchObject({ outcome: "failed", cause });
        await expect(providerCall("PSN", async () => [])).resolves.toEqual([]);
        await expect(providerCall("PSN", async () => [1])).resolves.toEqual([
            1,
        ]);
    });

    it("accepts HTTP date Retry-After and ignores malformed values", () => {
        jest.useFakeTimers().setSystemTime(new Date("2026-10-24T12:00:00Z"));
        try {
            const failure = (value: string) =>
                providerFailure("Xbox", {
                    response: {
                        status: 429,
                        headers: { "retry-after": value },
                    },
                });
            expect(failure("Sat, 24 Oct 2026 12:01:00 GMT").retryAfterMs).toBe(
                60000,
            );
            expect(failure("bad").retryAfterMs).toBeUndefined();
        } finally {
            jest.useRealTimers();
        }
    });
});

it("preserves Xbox auth SDK status/Retry-After from its documented attributes", () => {
    const cause = {
        data: {
            attributes: {
                extra: {
                    statusCode: 429,
                    response: { headers: { "retry-after": "90" } },
                },
            },
        },
    };
    expect(providerFailure("Xbox", cause)).toMatchObject({
        status: 429,
        retryAfterMs: 90000,
        outcome: "throttled",
        cause,
    });
});
