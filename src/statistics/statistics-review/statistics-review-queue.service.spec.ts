import { Test, TestingModule } from "@nestjs/testing";
import { StatisticsReviewQueueService } from "./statistics-review-queue.service";

describe("StatisticsReviewQueueService", () => {
    let service: StatisticsReviewQueueService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [StatisticsReviewQueueService],
        }).compile();

        service = module.get<StatisticsReviewQueueService>(
            StatisticsReviewQueueService,
        );
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });
});
