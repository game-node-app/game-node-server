import {
    playerBootstrapAt,
    PLAYER_REFRESH_INTERVAL_MS,
    playerGameSelection,
} from "./player-sync-policy";

test("existing accounts span a reproducible 24-hour window across restarts", () => {
    const now = new Date("2026-10-25T10:00:00Z");
    const first = Array.from({ length: 10000 }, (_, i) =>
        playerBootstrapAt(i + 1, `account-${i}`, now).getTime(),
    );
    const repeated = Array.from({ length: 10000 }, (_, i) =>
        playerBootstrapAt(i + 1, `account-${i}`, now).getTime(),
    );
    expect(repeated).toEqual(first);
    const offsets = first.map((value) => value - now.getTime());
    expect(Math.min(...offsets)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...offsets)).toBeLessThan(PLAYER_REFRESH_INTERVAL_MS);
    expect(
        new Set(offsets.map((value) => Math.floor(value / 3600000))).size,
    ).toBe(24);
});

test("an exact bootstrap slot is eligible rather than deferred another day", () => {
    const now = new Date("2026-10-25T00:00:00Z");
    const due = playerBootstrapAt(1, "account", now);
    expect(playerBootstrapAt(1, "account", due)).toEqual(due);
});

describe("achievement refresh selection", () => {
    const now = new Date("2026-10-25T00:00:00Z");
    const recentlyChecked = {
        checkedAt: new Date(now.getTime() - 2 * 86400000),
        outcome: "complete",
        activityFingerprint: "unchanged",
        nextEligibleAt: now,
        reconcileAt: new Date(now.getTime() + 5 * 86400000),
        retryAt: null,
        leaseExpiresAt: null,
    } as any;

    it("selects initial, changed, failed, and due reconciliation work", () => {
        expect(playerGameSelection(undefined, "first", now)).toBe("initial");
        expect(
            playerGameSelection(recentlyChecked, "changed", now),
        ).toBe("activity");
        expect(
            playerGameSelection(
                { ...recentlyChecked, outcome: "failed", retryAt: now } as any,
                "unchanged",
                now,
            ),
        ).toBe("retry");
        expect(
            playerGameSelection(
                { ...recentlyChecked, reconcileAt: now } as any,
                "unchanged",
                now,
            ),
        ).toBe("reconciliation");
    });

    it("skips an unchanged recently checked game", () => {
        expect(
            playerGameSelection(recentlyChecked, "unchanged", now),
        ).toBeUndefined();
    });

    it("keeps successful empty or unsupported results out of daily retries", () => {
        for (const outcome of ["empty", "unsupported"]) {
            expect(
                playerGameSelection(
                    { ...recentlyChecked, outcome } as any,
                    "unchanged",
                    now,
                ),
            ).toBeUndefined();
        }
    });

    it("uses changed mapping or catalogue fingerprints and due retries", () => {
        expect(
            playerGameSelection(recentlyChecked, "new-mapping-version", now),
        ).toBe("activity");
        expect(
            playerGameSelection(
                {
                    ...recentlyChecked,
                    outcome: "incomplete",
                    retryAt: new Date(now.getTime() + 60_000),
                } as any,
                "unchanged",
                now,
            ),
        ).toBeUndefined();
        expect(
            playerGameSelection(
                {
                    ...recentlyChecked,
                    outcome: "incomplete",
                    retryAt: now,
                } as any,
                "unchanged",
                now,
            ),
        ).toBe("retry");
    });
});
