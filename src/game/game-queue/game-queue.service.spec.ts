import { Test, TestingModule } from "@nestjs/testing";
import { GameQueueService } from "./game-queue.service";

describe("IgdbSyncQueueService", () => {
    let service: GameQueueService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [GameQueueService],
        }).compile();

        service = module.get<GameQueueService>(GameQueueService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });
});
