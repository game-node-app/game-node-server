import { Optional } from "@nestjs/common";
import { Processor } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { WorkerHostProcessor } from "../utils/WorkerHostProcessor";
import {
    GUILD_EVALUATE_JOB_NAME,
    GUILD_QUEUE_NAME,
    GuildEvaluationJobData,
} from "./guild-queue/guild-queue.constants";
import { GuildBountiesService } from "./guild-bounties.service";
import { GuildContractEvaluatorService } from "./guild-contract-evaluator.service";

@Processor(GUILD_QUEUE_NAME)
export class GuildContractEvaluatorProcessor extends WorkerHostProcessor {
    constructor(
        private readonly evaluatorService: GuildContractEvaluatorService,
        @Optional()
        private readonly guildBountiesService?: GuildBountiesService,
    ) {
        super();
    }

    async process(job: Job<GuildEvaluationJobData>) {
        if (job.name !== GUILD_EVALUATE_JOB_NAME) return;
        await this.evaluatorService.evaluateUserContracts(job.data.userId);

        // Bounty evaluation is cooperative and must never fail personal contracts.
        try {
            await this.guildBountiesService?.recordContributionsForUser(
                job.data.userId,
            );
        } catch (error) {
            this.logger.error(
                `Guild bounty contribution recording failed for user ${job.data.userId}: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
    }
}
