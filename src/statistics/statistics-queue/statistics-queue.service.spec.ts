import { Test, TestingModule } from "@nestjs/testing";
import { StatisticsQueueService } from "./statistics-queue.service";

describe("StatisticsQueueService", () => {
    let service: StatisticsQueueService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [StatisticsQueueService],
        }).compile();

        service = module.get<StatisticsQueueService>(StatisticsQueueService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });
});
