import { CollectionEntryStatus } from "../../collections/collections-entries/collections-entries.constants";
import { DAY_MS } from "../guild.constants";
import type { GuildEvaluatorFn } from "./types";
import { emptyEvaluation } from "./types";

/** The game must have been sitting in `planned` at least this long pre-accept. */
export const GUILD_TRIAGE_MIN_PLANNED_DAYS = 30;

/** Manual moves out of a stale `planned` entry (spec: contracts). */
export const evaluateTriageBacklog: GuildEvaluatorFn = async ({
    query,
    contract,
    now,
}) => {
    const cutoff = new Date(
        contract.acceptedAt.getTime() - GUILD_TRIAGE_MIN_PLANNED_DAYS * DAY_MS,
    );
    const conditions = [
        "h.libraryUserId = ?",
        "h.source = ?",
        "h.fromStatus = ?",
        "h.toStatus IN (?, ?, ?)",
        "h.occurredAt >= ?",
        "h.occurredAt <= ?",
        // Only a backlog that already existed 30 days before acceptance counts.
        "COALESCE(ce.plannedAt, ce.createdAt) <= ?",
    ];
    const parameters: unknown[] = [
        contract.profileUserId,
        "manual",
        CollectionEntryStatus.PLANNED,
        CollectionEntryStatus.PLAYING,
        CollectionEntryStatus.FINISHED,
        CollectionEntryStatus.DROPPED,
        contract.acceptedAt,
        now,
        cutoff,
    ];
    if (contract.expiresAt !== null) {
        conditions.push("h.occurredAt < ?");
        parameters.push(contract.expiresAt);
    }
    if (contract.targetGameId !== null) {
        conditions.push("h.gameId = ?");
        parameters.push(contract.targetGameId);
    }

    const rows: Array<{ gameId: number; lastOccurredAt: Date }> =
        await query.query(
            `SELECT h.gameId AS gameId, MAX(h.occurredAt) AS lastOccurredAt
             FROM collection_entry_status_history h
             INNER JOIN collection_entry ce ON ce.id = h.collectionEntryId
             WHERE ${conditions.join(" AND ")}
             GROUP BY h.gameId`,
            parameters,
        );
    if (rows.length === 0) return emptyEvaluation();

    const completedAt = rows.reduce<Date | null>((latest, row) => {
        const occurredAt = new Date(row.lastOccurredAt);
        return latest === null || occurredAt > latest ? occurredAt : latest;
    }, null);
    const gameIds = rows.map((row) => Number(row.gameId));
    return {
        progress: gameIds.length,
        gameIds,
        sourceKeys: gameIds.map((gameId) => `game:${gameId}`),
        completedAt,
    };
};
