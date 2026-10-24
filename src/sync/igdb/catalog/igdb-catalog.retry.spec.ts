import { CatalogDataError, CatalogSourceError } from "./igdb-catalog.client";
import {
    catalogRetryDelay,
    isTransientCatalogError,
    runCatalogStage,
} from "./igdb-catalog.retry";

describe("catalog retry", () => {
    const runtime = {
        now: () => 10000,
        random: () => 0,
        sleep: jest.fn().mockResolvedValue(undefined),
    };
    const budget = (initial = 0) => {
        let count = initial;
        return {
            read: async () => count,
            increment: async () => ++count,
            success: jest.fn(async () => {
                count = 0;
            }),
        };
    };
    beforeEach(() => runtime.sleep.mockClear());
    it("uses exactly three persisted attempts and 1000/2000 ms delays by default", async () => {
        const work = jest.fn().mockRejectedValue(new CatalogSourceError(503));
        const state = budget();
        await expect(
            runCatalogStage(work, state, runtime),
        ).rejects.toMatchObject({ status: 503 });
        expect(work).toHaveBeenCalledTimes(3);
        expect(runtime.sleep.mock.calls.map((args) => args[0])).toEqual([
            1000, 2000,
        ]);
        expect(await state.read()).toBe(3);
        await expect(runCatalogStage(work, state, runtime)).rejects.toThrow(
            "exhausted",
        );
        expect(work).toHaveBeenCalledTimes(3);
    });
    it("retains recovered attempts and clears only on success", async () => {
        const state = budget(2);
        const work = jest.fn().mockResolvedValue(42);
        expect(await runCatalogStage(work, state, runtime)).toBe(42);
        expect(work).toHaveBeenCalledTimes(1);
        expect(await state.read()).toBe(0);
    });
    it.each([
        new CatalogDataError("invalid"),
        new CatalogSourceError(401),
        new Error("deterministic"),
    ])("rejects deterministic errors immediately", async (error) => {
        const work = jest.fn().mockRejectedValue(error);
        await expect(runCatalogStage(work, budget(), runtime)).rejects.toBe(
            error,
        );
        expect(work).toHaveBeenCalledTimes(1);
        expect(runtime.sleep).not.toHaveBeenCalled();
    });
    it("classifies transient timeouts, 429/5xx and MySQL deadlocks", () => {
        for (const error of [
            new CatalogSourceError(429),
            new CatalogSourceError(500),
            { code: "ETIMEDOUT" },
            { driverError: { code: "ER_LOCK_DEADLOCK" } },
            { errno: 1205 },
            { driverError: { code: "ER_QUERY_TIMEOUT" } },
            { code: "PROTOCOL_SEQUENCE_TIMEOUT" },
            { errno: 3024 },
        ])
            expect(isTransientCatalogError(error)).toBe(true);
        expect(isTransientCatalogError(new CatalogSourceError(400))).toBe(
            false,
        );
    });
    it("caps exponential jitter and Retry-After seconds/dates", () => {
        expect(
            catalogRetryDelay(1, null, { ...runtime, random: () => 1 }),
        ).toBe(1250);
        expect(catalogRetryDelay(10, null, runtime)).toBe(30000);
        expect(
            catalogRetryDelay(
                1,
                new CatalogSourceError(429, undefined, "999"),
                runtime,
            ),
        ).toBe(30000);
        expect(
            catalogRetryDelay(
                1,
                new CatalogSourceError(429, undefined, "2"),
                runtime,
            ),
        ).toBe(2000);
        expect(
            catalogRetryDelay(
                1,
                new CatalogSourceError(
                    429,
                    undefined,
                    new Date(15000).toUTCString(),
                ),
                runtime,
            ),
        ).toBe(5000);
        expect(
            catalogRetryDelay(
                1,
                new CatalogSourceError(429, undefined, "junk"),
                runtime,
            ),
        ).toBe(1000);
    });
});
