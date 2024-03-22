import { Test, TestingModule } from "@nestjs/testing";
import { StatisticsController } from "./statistics.controller";
import { CACHE_MANAGER } from "@nestjs/cache-manager";

describe("StatisticsController", () => {
    let controller: StatisticsController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [StatisticsController],
            providers: [
                {
                    provide: CACHE_MANAGER,
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
