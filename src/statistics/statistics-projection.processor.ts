import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job, UnrecoverableError } from "bullmq";
import { StatisticsProjectionService } from "./statistics-projection.service";
import { STATISTICS_PROJECTION_QUEUE } from "./statistics-projection.constants";

@Processor(STATISTICS_PROJECTION_QUEUE, { concurrency: 2 })
export class StatisticsProjectionProcessor extends WorkerHost {
    constructor(private readonly projectionService: StatisticsProjectionService) {
        super();
    }

    async process(job: Job): Promise<number> {
        if (job.name !== "drain")
            throw new UnrecoverableError("Unsupported statistics projection job");
        return this.projectionService.drain();
    }
}
