import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bull";
import { Queue } from "bull";
import { GAME_QUEUE_NAME } from "./game-queue.constants";

/**
 * Queue responsible for syncing games from IGDB (results already fetched) to our database.
 * This queue is used by the IGDB Sync service. It doesn't process the results on its own. <br><br>
 * See game-queue.processor.ts for processing logic.
 */
@Injectable()
export class GameQueueService {
    private logger = new Logger(GameQueueService.name);

    constructor(
        @InjectQueue(GAME_QUEUE_NAME)
        private readonly gameQueue: Queue,
    ) {}

    /**
     * @param games - assumed to be in the format of IGDB's API response (snake_case).
     */
    async handle(games: any[]) {
        await this.gameQueue.add(games, {});
    }
}
