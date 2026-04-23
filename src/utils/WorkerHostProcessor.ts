import { OnWorkerEvent, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";

export abstract class WorkerHostProcessor extends WorkerHost {
    logger = new Logger(WorkerHostProcessor.name);

    @OnWorkerEvent("failed")
    onFailed(job: Job) {
        if (job == undefined) return;
        const { id, name, queueName, failedReason, stacktrace } = job;
        this.logger.error(
            `Job id: ${id}, name: ${name} failed in queue ${queueName}. Failed reason: ${failedReason}`,
        );
        if (stacktrace) {
            this.logger.error(`Stack trace: ${stacktrace}`);
        }
    }
}
