import { Test, TestingModule } from "@nestjs/testing";
import { AchievementsQueueService } from "./achievements-queue.service";
import { ACHIEVEMENTS_QUEUE_NAME } from "./achievements-queue.constants";
import { BullModule, getQueueToken } from "@nestjs/bull";

describe("AchievementsQueueService", () => {
    let service: AchievementsQueueService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            imports: [BullModule.forRoot({})],
            providers: [
                AchievementsQueueService,
                {
                    provide: getQueueToken(ACHIEVEMENTS_QUEUE_NAME),
                    useValue: {
                        add: jest.fn(async () => {}),
                    },
                },
            ],
        }).compile();

        service = module.get<AchievementsQueueService>(
            AchievementsQueueService,
        );
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });
});
