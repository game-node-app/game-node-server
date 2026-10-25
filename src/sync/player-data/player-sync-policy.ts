import { createHash } from "node:crypto";
export const PLAYER_REFRESH_INTERVAL_MS = 24 * 60 * 60_000;
export const PLAYER_RECONCILE_INTERVAL_MS = 7 * PLAYER_REFRESH_INTERVAL_MS;

export function playerBootstrapAt(
    connectionId: number,
    sourceUserId: string,
    now: Date,
): Date {
    const slot =
        createHash("sha256")
            .update(JSON.stringify([connectionId, sourceUserId]))
            .digest()
            .readUInt32BE(0) % PLAYER_REFRESH_INTERVAL_MS;
    const today = now.getTime() - (now.getTime() % PLAYER_REFRESH_INTERVAL_MS);
    const candidate = today + slot;
    return new Date(
        candidate < now.getTime()
            ? candidate + PLAYER_REFRESH_INTERVAL_MS
            : candidate,
    );
}

import type { PlayerGameSync } from "./entity/player-game-sync.entity";
export type PlayerGameSelectionReason =
    | "initial"
    | "activity"
    | "retry"
    | "reconciliation"
    | "manual";

export function playerGameSelection(
    state: PlayerGameSync | undefined,
    fingerprint: string | undefined,
    now: Date,
): PlayerGameSelectionReason | undefined {
    if (!state) return "initial";
    if (
        state.nextEligibleAt > now ||
        (state.retryAt && state.retryAt > now) ||
        (state.leaseExpiresAt && state.leaseExpiresAt > now)
    )
        return undefined;
    if (
        ["failed", "incomplete", "throttled", "unavailable"].includes(
            state.outcome,
        )
    )
        return "retry";
    if (!state.checkedAt) return "initial";
    if (fingerprint == null) return "manual";
    if (state.activityFingerprint !== fingerprint) return "activity";
    if (state.reconcileAt <= now) return "reconciliation";
    return undefined;
}
