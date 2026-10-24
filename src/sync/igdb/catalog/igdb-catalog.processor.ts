import { Processor, WorkerHost, InjectQueue } from "@nestjs/bullmq";
import { OnModuleInit } from "@nestjs/common";
import { Job, Queue } from "bullmq";
import {
    IGDB_CATALOG_JOB_NAME,
    IGDB_CATALOG_QUEUE_NAME,
    catalogJobId,
} from "./igdb-catalog.constants";
import { IgdbCatalogRunnerService } from "./igdb-catalog-runner.service";

@Processor(IGDB_CATALOG_QUEUE_NAME, { concurrency: 1 })
export class IgdbCatalogProcessor extends WorkerHost implements OnModuleInit {
    constructor(
        private readonly runner: IgdbCatalogRunnerService,
        @InjectQueue(IGDB_CATALOG_QUEUE_NAME) private readonly queue: Queue,
    ) {
        super();
    }
    async onModuleInit() {
        await this.queue.setGlobalConcurrency(1);
    }
    async process(job: Job<{ runId: string }>) {
        if (
            job.name !== IGDB_CATALOG_JOB_NAME ||
            typeof job.data?.runId !== "string" ||
            Object.keys(job.data).length !== 1 ||
            job.id !== catalogJobId(job.data.runId)
        )
            return;
        await this.runner.run(job.data.runId);
    }
}
