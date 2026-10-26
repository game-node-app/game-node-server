import { Injectable } from "@nestjs/common";
import { EConnectionType } from "../../connection/connections.constants";
import { PlayerDataQueueService } from "../../sync/player-data/player-data-queue.service";

@Injectable()
export class PlaytimeWatchService {
    constructor(private readonly queue: PlayerDataQueueService) {}
    registerJob(userId: string, source: EConnectionType) {
        return this.queue.request(userId, source);
    }
}
