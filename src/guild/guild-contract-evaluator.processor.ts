import { Processor } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { WorkerHostProcessor } from "../utils/WorkerHostProcessor";
import {
    GUILD_EVALUATE_JOB_NAME,
    GUILD_QUEUE_NAME,
    GuildEvaluationJobData,
} from "./guild-queue/guild-queue.constants";
import { GuildContractEvaluatorService } from "./guild-contract-evaluator.service";

@Processor(GUILD_QUEUE_NAME)
export class GuildContractEvaluatorProcessor extends WorkerHostProcessor {
    constructor(
        private readonly evaluatorService: GuildContractEvaluatorService,
    ) {
        super();
    }

    async process(job: Job<GuildEvaluationJobData>) {
        if (job.name !== GUILD_EVALUATE_JOB_NAME) return;
        await this.evaluatorService.evaluateUserContracts(job.data.userId);
    }
}
