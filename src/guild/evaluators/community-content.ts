import {
    DAY_MS,
    GuildContractStatus,
    GuildObjectiveType,
} from "../guild.constants";
import type { GuildEvaluatorFn } from "./types";
import { addWindowConditions } from "./types";
import { addGameCriteriaConditions } from "./game-criteria";

export const GUILD_MIN_COLLECTION_DESCRIPTION_CHARS = 20;
export const GUILD_MIN_COLLECTION_ENTRIES = 5;
/** A credited collection cannot be farmed again for this long (spec: contracts). */
export const GUILD_COLLECTION_CREDIT_COOLDOWN_DAYS = 30;

/** Public, described collections with enough games, minus recently credited ones. */
export const evaluateCurateCollection: GuildEvaluatorFn = async ({
    query,
    contract,
    now,
}) => {
    const conditions = [
        "c.libraryUserId = ?",
        "c.isPublic = 1",
        "CHAR_LENGTH(TRIM(COALESCE(c.description, ''))) >= ?",
        `(SELECT COUNT(DISTINCT ce.gameId)
            FROM collection_entry_collections_collection m
            INNER JOIN collection_entry ce ON ce.id = m.collectionEntryId
            WHERE m.collectionId = c.id) >= ?`,
        `NOT EXISTS (SELECT 1 FROM guild_contract credited
            WHERE credited.profileUserId = ?
              AND credited.objectiveType = ?
              AND credited.status = ?
              AND credited.claimedAt IS NOT NULL
              AND credited.claimedAt >= ?
              AND JSON_CONTAINS(
                  credited.claimPayload, JSON_QUOTE(c.id), '$.creditedCollectionIds'))`,
    ];
    const parameters: unknown[] = [
        contract.profileUserId,
        GUILD_MIN_COLLECTION_DESCRIPTION_CHARS,
        contract.criteria.minCollectionEntries ?? GUILD_MIN_COLLECTION_ENTRIES,
        contract.profileUserId,
        GuildObjectiveType.CURATE_COLLECTION,
        GuildContractStatus.COMPLETED,
        new Date(
            now.getTime() - GUILD_COLLECTION_CREDIT_COOLDOWN_DAYS * DAY_MS,
        ),
    ];
    addWindowConditions(conditions, parameters, "c.updatedAt", contract, now);

    const rows: Array<{ id: string; updatedAt: Date }> = await query.query(
        `SELECT c.id AS id, c.updatedAt AS updatedAt
         FROM collection c
         WHERE ${conditions.join(" AND ")}`,
        parameters,
    );
    const completedAt = rows.reduce<Date | null>((latest, row) => {
        const updatedAt = new Date(row.updatedAt);
        return latest === null || updatedAt > latest ? updatedAt : latest;
    }, null);

    return {
        progress: rows.length,
        gameIds: [],
        sourceKeys: rows.map((row) => row.id),
        completedAt,
    };
};

/** HTML tags are stripped in Node before the plain-text length check. */
export const stripPostHtml = (content: string): string =>
    content.replace(/<[^>]*>/g, "").trim();

/** Non-deleted posts in the window, counted by distinct game. */
export const evaluatePublishPost: GuildEvaluatorFn = async ({
    query,
    contract,
    now,
}) => {
    const conditions = ["p.profileUserId = ?", "p.deletedAt IS NULL"];
    const parameters: unknown[] = [contract.profileUserId];
    addWindowConditions(conditions, parameters, "p.createdAt", contract, now);
    if (contract.targetGameId !== null) {
        conditions.push("p.gameId = ?");
        parameters.push(contract.targetGameId);
    }
    addGameCriteriaConditions(
        conditions,
        parameters,
        contract.criteria,
        "p.gameId",
    );

    const rows: Array<{
        id: string;
        gameId: number;
        content: string;
        createdAt: Date;
    }> = await query.query(
        `SELECT p.id AS id, p.gameId AS gameId, p.content AS content,
                    p.createdAt AS createdAt
             FROM post p
             WHERE ${conditions.join(" AND ")}`,
        parameters,
    );
    const minChars = contract.criteria.minPostChars ?? 80;
    const qualifying = rows.filter(
        (row) => stripPostHtml(row.content).length >= minChars,
    );
    const gameIds = [...new Set(qualifying.map((row) => Number(row.gameId)))];
    const completedAt = qualifying.reduce<Date | null>((latest, row) => {
        const createdAt = new Date(row.createdAt);
        return latest === null || createdAt > latest ? createdAt : latest;
    }, null);

    return {
        progress: gameIds.length,
        gameIds,
        sourceKeys: qualifying.map((row) => `post:${row.id}`),
        completedAt,
    };
};
