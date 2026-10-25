import { setPlayerProviderBudget } from "./player-provider-budget.service";
import {
    cancellableProviderCall,
    runPlayerSyncAttempt,
    assertPlayerSyncActive,
    currentPlayerSyncObservationAt,
    PLAYER_ATTEMPT_TIMEOUT_MS,
    PLAYER_REQUEST_TIMEOUT_MS,
} from "./player-sync-attempt";

describe("player synchronization deadlines", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("cancels a hung cancellable request and cleans up its timer", async () => {
        let released = false;
        const pending = runPlayerSyncAttempt(() =>
            cancellableProviderCall(
                "Xbox",
                (signal) =>
                    new Promise((_, reject) => {
                        signal.addEventListener(
                            "abort",
                            () => {
                                released = true;
                                reject(new Error("cancelled"));
                            },
                            { once: true },
                        );
                    }),
            ),
        );
        const assertion = expect(pending).rejects.toMatchObject({
            outcome: "failed",
        });
        await jest.advanceTimersByTimeAsync(PLAYER_REQUEST_TIMEOUT_MS);
        await assertion;
        expect(released).toBe(true);
        expect(jest.getTimerCount()).toBe(0);
    });

    it("rejects overlong page sequences before another request starts", async () => {
        const leaf = jest.fn().mockResolvedValue([]);
        await expect(
            runPlayerSyncAttempt(async () => {
                await leaf();
                jest.setSystemTime(Date.now() + PLAYER_ATTEMPT_TIMEOUT_MS);
                assertPlayerSyncActive();
                await leaf();
            }),
        ).rejects.toMatchObject({ outcome: "failed" });
        expect(leaf).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    it("keeps the parent deadline through nested orchestration", async () => {
        await expect(
            runPlayerSyncAttempt(async () => {
                jest.setSystemTime(Date.now() + PLAYER_ATTEMPT_TIMEOUT_MS);
                return runPlayerSyncAttempt(async () => {
                    assertPlayerSyncActive();
                });
            }),
        ).rejects.toThrow("attempt deadline exceeded");
    });

    it("keeps concurrent attempts independent", async () => {
        await expect(
            Promise.all([
                runPlayerSyncAttempt(async () => {
                    assertPlayerSyncActive();
                    return 1;
                }),
                runPlayerSyncAttempt(async () => {
                    assertPlayerSyncActive();
                    return 2;
                }),
            ]),
        ).resolves.toEqual([1, 2]);
    });

    it("uses one observation timestamp through nested work in an attempt", async () => {
        const startedAt = new Date("2026-10-25T12:00:00.000Z");
        jest.setSystemTime(startedAt);

        await runPlayerSyncAttempt(async () => {
            const observationAt = currentPlayerSyncObservationAt();
            jest.setSystemTime(new Date(startedAt.getTime() + 5 * 60_000));
            await runPlayerSyncAttempt(async () => {
                expect(currentPlayerSyncObservationAt()).toEqual(observationAt);
            });
        });
    });
});

beforeEach(() => setPlayerProviderBudget({ run: (_provider, work) => work() }));
