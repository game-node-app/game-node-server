import { Test, TestingModule } from "@nestjs/testing";
import { StatisticsController } from "./statistics.controller";
import { StatisticsService } from "./statistics.service";

describe("StatisticsController", () => {
    let controller: StatisticsController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [StatisticsController],
            providers: [
                {
                    provide: StatisticsService,
                    useValue: {},
                },
            ],
        }).compile();

        controller = module.get<StatisticsController>(StatisticsController);
    });

    it("should be defined", () => {
        expect(controller).toBeDefined();
    });
});
