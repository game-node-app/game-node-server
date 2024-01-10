import { Test, TestingModule } from "@nestjs/testing";
import { ActivitiesQueueService } from "./activities-queue.service";
import { BullModule, getQueueToken } from "@nestjs/bull";

describe("ActivitiesFeedService", () => {
    let service: ActivitiesQueueService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ActivitiesQueueService,
                {
                    provide: getQueueToken("activities"),
                    useValue: {},
                },
            ],
        }).compile();

        service = module.get<ActivitiesQueueService>(ActivitiesQueueService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });
});
