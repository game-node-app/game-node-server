import { Injectable } from "@nestjs/common";
import { EConnectionType } from "../../connection/connections.constants";
import { PlayerDataQueueService } from "../../sync/player-data/player-data-queue.service";

@Injectable()
export class PlaytimeWatchService {
    constructor(private readonly queue: PlayerDataQueueService) {}
    status(userId: string, source: EConnectionType) {
        return this.queue.status(userId, source);
    }
    gameStatus(
        userId: string,
        source: EConnectionType,
        externalGameId: number,
    ) {
        return this.queue.gameStatus(userId, source, externalGameId);
    }
    registerJob(userId: string, source: EConnectionType) {
        return this.queue.request(userId, source);
    }
}
