import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bull";
import { Queue } from "bull";
import { IGDB_SYNC_QUEUE_NAME } from "./igdb-sync-queue.constants";

/**
 * Queue responsible for syncing games from IGDB (results already fetched) to our database.
 * This queue is used by the IGDB Sync service. It doesn't process the results on its own. <br><br>
 * See igdb-sync-queue.processor.ts for processing logic.
 */
@Injectable()
export class IgdbSyncQueueService {
    private logger = new Logger(IgdbSyncQueueService.name);

    constructor(
        @InjectQueue(IGDB_SYNC_QUEUE_NAME)
        private readonly igdbSyncQueue: Queue,
    ) {}

    /**
     * @param results - assumed to be in the format of IGDB's API response (snake_case).
     */
    async handle(results: any[]) {
        this.logger.log(
            `Received request to process ${results.length} IGDB results`,
        );
        await this.igdbSyncQueue.add(results, {
            delay: 5000,
        });
    }
}
