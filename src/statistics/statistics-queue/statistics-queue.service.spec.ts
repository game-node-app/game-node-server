import { Test, TestingModule } from "@nestjs/testing";
import { StatisticsQueueService } from "./statistics-queue.service";
import { getQueueToken } from "@nestjs/bullmq";
import { STATISTICS_QUEUE_NAME } from "./statistics-queue.constants";

describe("StatisticsQueueService", () => {
    let service: StatisticsQueueService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                StatisticsQueueService,
                {
                    provide: getQueueToken(STATISTICS_QUEUE_NAME),
                    useValue: {
                        add: jest.fn(async () => {}),
                    },
                },
            ],
        }).compile();

        service = module.get<StatisticsQueueService>(StatisticsQueueService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });
});
