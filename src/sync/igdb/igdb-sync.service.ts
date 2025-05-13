import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import {
    IGDB_SYNC_JOB_NAME,
    IGDB_SYNC_QUEUE_NAME,
} from "./igdb-sync.constants";
import { Queue } from "bullmq";
import dayjs from "dayjs";

export interface NonParsedGame {
    id: number;
    // IGDB Dates are always returned in seconds, even if they are
    // unix timestamps.
    updated_at: number;
}

function filterRecentlyUpdated(items: NonParsedGame[]) {
    const now = dayjs();
    return items.filter((item) => {
        if (item.updated_at && !Number.isNaN(item.updated_at)) {
            const updatedAtDate = dayjs(item.updated_at * 1000);

            // Less than 14 days since last update
            // Gives some headroom in case the weekly update fails once
            const diff = now.diff(updatedAtDate, "d");

            return diff <= 14;
        }

        // Safeguard to not skip items
        return true;
    });
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

    async registerUpdateJob(items: NonNullable<NonParsedGame[]>) {
        if (items == undefined || !Array.isArray(items)) {
            this.logger.error(`Ignoring malformed message in update: ${items}`);
            return;
        }

        // Greatly reduces memory usage by only queueing usable items
        const filteredJobItems = filterRecentlyUpdated(items);

        const chunks = this.msgToChunks(filteredJobItems);
        for (const chunk of chunks) {
            await this.igdbSyncQueue.add(IGDB_SYNC_JOB_NAME, chunk);
        }
    }
}
