import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import {
    IGDB_SYNC_JOB_NAME,
    IGDB_SYNC_QUEUE_NAME,
} from "./igdb-sync.constants";
import { Queue } from "bullmq";

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

    private msgToChunks(msg: NonNullable<object[]>) {
        const chunkSize = 10;
        const chunks: object[][] = [];
        let temp_chunk: object[] = [];
        for (let i = 0; i < msg.length; i++) {
            temp_chunk.push(msg[i]);
            if (
                temp_chunk.length !== 0 &&
                temp_chunk.length % chunkSize === 0
            ) {
                chunks.push(temp_chunk);
                temp_chunk = [];
            }
        }
        return chunks;
    }

    async registerUpdateJob(job: NonNullable<object[]>) {
        if (job == undefined || !Array.isArray(job)) {
            this.logger.error(`Ignoring malformed message in update: ${job}`);
            return;
        }
        const chunks = this.msgToChunks(job);
        for (const chunk of chunks) {
            await this.igdbSyncQueue.add(IGDB_SYNC_JOB_NAME, chunk);
        }
    }
}
