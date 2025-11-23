import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import {
    IGDB_SYNC_JOB_NAME,
    IGDB_SYNC_QUEUE_NAME,
} from "./igdb-sync.constants";
import { Queue } from "bullmq";
import dayjs from "dayjs";
import { normalizeIgdbResults } from "./utils/game-conversor-utils";

export interface NonParsedGame {
    id: number;
    // IGDB Dates are always returned in seconds, even if they are
    // unix timestamps.
    updated_at: number;
}
/**
 * Queue responsible for syncing games from IGDB (results already fetched) to our database.
 * This queue is used by the IGDB Sync service. It doesn't process the results on its own. <br><br>
 * See game-queue.processor.ts for processing logic.
 */
@Injectable()
export class IgdbSyncService {
    private logger = new Logger(IgdbSyncService.name);

    constructor(
        @InjectQueue(IGDB_SYNC_QUEUE_NAME)
        private readonly igdbSyncQueue: Queue,
    ) {}

    async registerUpdateJob(items: NonNullable<NonParsedGame[]>) {
        if (items == undefined || !Array.isArray(items)) {
            this.logger.error(`Ignoring malformed message in update: ${items}`);
            return;
        }

        const normalizedItems = normalizeIgdbResults(items);

        const jobs = normalizedItems.map((item) => ({
            name: IGDB_SYNC_JOB_NAME,
            data: item,
        }));

        await this.igdbSyncQueue.addBulk(jobs);
    }
}
