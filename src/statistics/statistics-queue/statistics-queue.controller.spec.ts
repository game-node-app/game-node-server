import { Test, TestingModule } from "@nestjs/testing";
import { StatisticsQueueController } from "./statistics-queue.controller";

describe("StatisticsQueueController", () => {
    let controller: StatisticsQueueController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [StatisticsQueueController],
        }).compile();

        controller = module.get<StatisticsQueueController>(
            StatisticsQueueController,
        );
    });

    it("should be defined", () => {
        expect(controller).toBeDefined();
    });
});
