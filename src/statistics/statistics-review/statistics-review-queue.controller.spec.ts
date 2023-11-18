import { Test, TestingModule } from "@nestjs/testing";
import { StatisticsReviewQueueController } from "./statistics-review-queue.controller";

describe("StatisticsReviewQueueController", () => {
    let controller: StatisticsReviewQueueController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [StatisticsReviewQueueController],
        }).compile();

        controller = module.get<StatisticsReviewQueueController>(
            StatisticsReviewQueueController,
        );
    });

    it("should be defined", () => {
        expect(controller).toBeDefined();
    });
});
