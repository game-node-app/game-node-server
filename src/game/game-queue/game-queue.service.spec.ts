import { Test, TestingModule } from "@nestjs/testing";
import { GameQueueService } from "./game-queue.service";
import { getQueueToken } from "@nestjs/bull";
import { GAME_QUEUE_NAME } from "./game-queue.constants";

describe("GameQueueService", () => {
    let service: GameQueueService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                GameQueueService,
                {
                    provide: getQueueToken(GAME_QUEUE_NAME),
                    useValue: {
                        add: jest.fn(async () => {}),
                    },
                },
            ],
        }).compile();

        service = module.get<GameQueueService>(GameQueueService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });
});
