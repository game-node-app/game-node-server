import { DailyStatus } from "../../daily/daily.constants";
import type { GuildEvaluatorFn } from "./types";
import { addWindowConditions } from "./types";

/** Won Daily puzzles in the window; practice rounds live elsewhere. */
export const evaluateDailyChallenge: GuildEvaluatorFn = async ({
    query,
    contract,
    now,
}) => {
    const conditions = [
        "d.userId = ?",
        "d.status = ?",
        "d.finishedAt IS NOT NULL",
    ];
    const parameters: unknown[] = [contract.profileUserId, DailyStatus.WON];
    addWindowConditions(conditions, parameters, "d.finishedAt", contract, now);
    if (contract.criteria.requireNoDailyHint === true) {
        conditions.push("d.hintAt IS NULL");
    }
    if (contract.criteria.maxDailyAttempts != null) {
        conditions.push("d.attempts <= ?");
        parameters.push(contract.criteria.maxDailyAttempts);
    }

    const rows: Array<{ id: number; finishedAt: Date }> = await query.query(
        `SELECT d.id AS id, d.finishedAt AS finishedAt
         FROM daily_result d
         WHERE ${conditions.join(" AND ")}`,
        parameters,
    );
    const completedAt = rows.reduce<Date | null>((latest, row) => {
        const finishedAt = new Date(row.finishedAt);
        return latest === null || finishedAt > latest ? finishedAt : latest;
    }, null);

    return {
        progress: rows.length,
        gameIds: [],
        sourceKeys: rows.map((row) => `daily:${row.id}`),
        completedAt,
    };
};
