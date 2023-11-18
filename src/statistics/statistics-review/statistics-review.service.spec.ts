import { Test, TestingModule } from "@nestjs/testing";
import { StatisticsReviewService } from "./statistics-review.service";

describe("StatisticsReviewService", () => {
    let service: StatisticsReviewService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [StatisticsReviewService],
        }).compile();

        service = module.get<StatisticsReviewService>(StatisticsReviewService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });
});
