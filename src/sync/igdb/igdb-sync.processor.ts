import { Processor } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import {
    IGDB_SYNC_JOB_NAME,
    IGDB_SYNC_QUEUE_NAME,
} from "./igdb-sync.constants";
import { WorkerHostProcessor } from "../../utils/WorkerHostProcessor";
import { GameRepositoryCreateService } from "../../game/game-repository/create/game-repository-create.service";
import { IGDBPartialGame } from "../../game/game-repository/game-repository.types";

@Processor(IGDB_SYNC_QUEUE_NAME, {
    concurrency: 5,
})
export class IgdbSyncProcessor extends WorkerHostProcessor {
    logger = new Logger(IgdbSyncProcessor.name);

    constructor(
        private readonly gameRepositoryCreateService: GameRepositoryCreateService,
    ) {
        super();
    }

    async process(job: Job<IGDBPartialGame>) {
        if (job.name === IGDB_SYNC_JOB_NAME) {
            await this.gameRepositoryCreateService.createOrUpdate(job.data);
        }
    }
}
