import { Test, TestingModule } from "@nestjs/testing";
import { StatisticsQueueController } from "./statistics-queue.controller";
import { StatisticsService } from "../statistics.service";
import { StatisticsQueueService } from "./statistics-queue.service";

describe("StatisticsQueueController", () => {
    let controller: StatisticsQueueController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [StatisticsQueueController],
            providers: [
                {
                    provide: StatisticsQueueService,
                    useValue: {
                        registerLike: jest.fn(),
                        registerView: jest.fn(),
                    },
                },
            ],
        }).compile();

        controller = module.get<StatisticsQueueController>(
            StatisticsQueueController,
        );
    });

    it("should be defined", () => {
        expect(controller).toBeDefined();
    });
});
