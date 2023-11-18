import { Test, TestingModule } from "@nestjs/testing";
import { StatisticsReviewController } from "./statistics-review.controller";

describe("StatisticsReviewController", () => {
    let controller: StatisticsReviewController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [StatisticsReviewController],
        }).compile();

        controller = module.get<StatisticsReviewController>(
            StatisticsReviewController,
        );
    });

    it("should be defined", () => {
        expect(controller).toBeDefined();
    });
});
