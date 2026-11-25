import { GuildObjectiveType } from "../guild.constants";
import { evaluateFinishGame } from "./finish-game";
import { evaluateWriteReview } from "./write-review";
import { evaluateLogPlaytime, evaluatePlayDistinctDays } from "./playtime";
import { evaluateDailyChallenge } from "./daily";
import {
    evaluateCompleteGame100,
    evaluateEarnGameAchievements,
} from "./game-achievements";
import {
    evaluateCurateCollection,
    evaluatePublishPost,
} from "./community-content";
import { evaluateTriageBacklog } from "./triage-backlog";
import type {
    GuildEvaluationContext,
    GuildEvaluatorFn,
    GuildObjectiveEvaluation,
} from "./types";
import { emptyEvaluation } from "./types";

/** One focused evaluator per objective; plain map, no DI framework (design 3). */
export const GUILD_OBJECTIVE_EVALUATORS: Record<
    GuildObjectiveType,
    GuildEvaluatorFn
> = {
    [GuildObjectiveType.FINISH_GAME]: evaluateFinishGame,
    [GuildObjectiveType.WRITE_REVIEW]: evaluateWriteReview,
    [GuildObjectiveType.LOG_PLAYTIME]: evaluateLogPlaytime,
    [GuildObjectiveType.PLAY_DISTINCT_DAYS]: evaluatePlayDistinctDays,
    [GuildObjectiveType.DAILY_CHALLENGE]: evaluateDailyChallenge,
    [GuildObjectiveType.EARN_GAME_ACHIEVEMENTS]: evaluateEarnGameAchievements,
    [GuildObjectiveType.COMPLETE_GAME_100]: evaluateCompleteGame100,
    [GuildObjectiveType.CURATE_COLLECTION]: evaluateCurateCollection,
    [GuildObjectiveType.PUBLISH_POST]: evaluatePublishPost,
    [GuildObjectiveType.TRIAGE_BACKLOG]: evaluateTriageBacklog,
};

/** Runs the objective's evaluator; unknown legacy values evaluate to zero. */
export async function evaluateGuildObjective(
    context: GuildEvaluationContext,
): Promise<GuildObjectiveEvaluation> {
    const evaluator =
        GUILD_OBJECTIVE_EVALUATORS[context.contract.objectiveType];
    return evaluator ? evaluator(context) : emptyEvaluation();
}

export * from "./types";
export * from "./game-criteria";
export * from "./bonus-objective";
