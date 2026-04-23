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

const DEFAULT_IGDB_SYNC_CONCURRENCY = 8;
const igdbSyncConcurrency = resolveIgdbSyncConcurrency();

@Processor(IGDB_SYNC_QUEUE_NAME, {
    concurrency: igdbSyncConcurrency,
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

function resolveIgdbSyncConcurrency(): number {
    const rawValue = process.env.IGDB_SYNC_CONCURRENCY;
    if (rawValue == undefined) {
        return DEFAULT_IGDB_SYNC_CONCURRENCY;
    }

    const parsedValue = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
        return DEFAULT_IGDB_SYNC_CONCURRENCY;
    }

    return parsedValue;
}
