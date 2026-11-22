import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";
import {
    GUILD_EVAL_DELAY_MS,
    GUILD_EVALUATE_JOB_NAME,
    GUILD_QUEUE_NAME,
    GuildEvaluationJobData,
    GuildEvaluationTrigger,
} from "./guild-queue.constants";

@Injectable()
export class GuildQueueService {
    private readonly logger = new Logger(GuildQueueService.name);

    constructor(
        @InjectQueue(GUILD_QUEUE_NAME)
        private readonly guildQueue: Queue<GuildEvaluationJobData>,
    ) {}

    /**
     * Schedules contract evaluation after the originating mutation commits.
     * Never throws: a queue outage must not fail the mutation that triggered it.
     */
    async enqueueEvaluation(
        userId: string,
        trigger: GuildEvaluationTrigger,
    ): Promise<void> {
        try {
            await this.guildQueue.add(
                GUILD_EVALUATE_JOB_NAME,
                { userId, trigger },
                {
                    delay: GUILD_EVAL_DELAY_MS,
                    backoff: { type: "exponential", delay: 1000 },
                    stackTraceLimit: 1,
                    // Dedup only while delayed, so facts committed during processing get a new job
                    deduplication: {
                        id: `guild-eval-${userId}`,
                        ttl: GUILD_EVAL_DELAY_MS,
                    },
                },
            );
        } catch (error) {
            this.logger.error(
                `Unable to enqueue guild evaluation for user ${userId}: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
    }
}
