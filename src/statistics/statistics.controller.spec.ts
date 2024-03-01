import { Test, TestingModule } from "@nestjs/testing";
import { StatisticsController } from "./statistics.controller";
import { StatisticsService } from "./statistics.service";
import { CACHE_MANAGER, CacheInterceptor } from "@nestjs/cache-manager";
import { PaginationInterceptor } from "../interceptor/pagination.interceptor";

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
