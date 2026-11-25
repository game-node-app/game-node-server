import type { PlaytimeHistoryService } from "../../playtime/playtime-history.service";
import type { GuildContract } from "../entities/guild-contract.entity";
import type { GuildTimeToBeatService } from "../guild-time-to-beat.service";
import type { GuildQueryExecutor } from "./game-criteria";

/** Everything an objective evaluator may read; each call is one user contract. */
export interface GuildEvaluationContext {
    query: GuildQueryExecutor;
    contract: GuildContract;
    now: Date;
    playtimeHistory: PlaytimeHistoryService;
    timeToBeat: Pick<GuildTimeToBeatService, "getForGameIds">;
}

export interface GuildObjectiveEvaluation {
    /** Units of progress, in the objective's own unit (minutes, days, games...). */
    progress: number;
    /** Distinct games that produced the progress (bonus objectives, bounties). */
    gameIds: number[];
    /** Stable identifiers of the qualifying facts (bounty dedupe, claim payload). */
    sourceKeys: string[];
    /** Latest qualifying fact, so bonus timing survives lazy evaluation. */
    completedAt: Date | null;
}

export type GuildEvaluatorFn = (
    context: GuildEvaluationContext,
) => Promise<GuildObjectiveEvaluation>;

export const emptyEvaluation = (): GuildObjectiveEvaluation => ({
    progress: 0,
    gameIds: [],
    sourceKeys: [],
    completedAt: null,
});

/** `[acceptedAt, min(expiresAt, now)]`, matching the contract window semantics. */
export function addWindowConditions(
    conditions: string[],
    parameters: unknown[],
    column: string,
    contract: Pick<GuildContract, "acceptedAt" | "expiresAt">,
    now: Date,
): void {
    conditions.push(`${column} >= ?`);
    parameters.push(contract.acceptedAt);
    if (contract.expiresAt !== null) {
        conditions.push(`${column} < ?`);
        parameters.push(contract.expiresAt);
    }
    conditions.push(`${column} <= ?`);
    parameters.push(now);
}

/** End of the counting window; playtime APIs take it as an end date. */
export function windowEnd(
    contract: Pick<GuildContract, "expiresAt">,
    now: Date,
): Date {
    return contract.expiresAt !== null && contract.expiresAt < now
        ? contract.expiresAt
        : now;
}
