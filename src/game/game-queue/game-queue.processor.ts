import { Process, Processor } from "@nestjs/bull";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { GameRepositoryService } from "../game-repository/game-repository.service";
import { Logger } from "@nestjs/common";
import { Job } from "bull";
import { GAME_QUEUE_NAME } from "./game-queue.constants";
import { normalizeIgdbResults } from "../utils/game-normalize";

@Processor(GAME_QUEUE_NAME)
export class GameQueueProcessor {
    private logger = new Logger(GameQueueProcessor.name);

    constructor(private readonly gameService: GameRepositoryService) {}

    @Process()
    async process(job: Job<any[]>) {
        const results = job.data;
        // this.logger.log(`Processing ${results.length} results`);

        const normalizedResults = normalizeIgdbResults(results);

        for (const result of normalizedResults) {
            // this.logger.log(`Processing result ${result.id}`);
            this.gameService
                .createOrUpdate(result)
                // .then(() => this.logger.log(`Processed result ${result.id}`))
                .catch((e) => {
                    this.logger.error(
                        `Error while processing result ${result.id}`,
                        e,
                    );
                });
        }
        // this.logger.log(`SUCCESS: Processed ${results.length} results`);
    }
}
