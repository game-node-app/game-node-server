import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { InjectQueue } from "@nestjs/bullmq";
import { IGDB_SYNC_QUEUE_NAME } from "./igdb-sync.constants";
import { Queue } from "bullmq";

@Controller("igdb-sync")
@ApiTags("igdb-sync")
export class IgdbSyncController {
    constructor(
        @InjectQueue(IGDB_SYNC_QUEUE_NAME) private igdbSyncQueue: Queue,
    ) {}

    @Get("jobs")
    async getJobs() {
        return {
            jobs: await this.igdbSyncQueue.getJobs(),
            repeatableJobs: await this.igdbSyncQueue.getRepeatableJobs(),
        };
    }
}
