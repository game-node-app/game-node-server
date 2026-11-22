export const GUILD_QUEUE_NAME = "guild-queue";

export const GUILD_EVALUATE_JOB_NAME = "evaluate-user-contracts";

export const GUILD_EVAL_DELAY_MS = 2000;

export type GuildEvaluationTrigger = "collection_entry" | "review" | "playtime";

export interface GuildEvaluationJobData {
    userId: string;
    trigger: GuildEvaluationTrigger;
}
