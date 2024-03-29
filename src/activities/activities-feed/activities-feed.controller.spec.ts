import { Test, TestingModule } from "@nestjs/testing";
import { ActivitiesFeedController } from "./activities-feed.controller";
import { ActivitiesFeedService } from "./activities-feed.service";
import { CACHE_MANAGER } from "@nestjs/cache-manager";

describe("ActivitiesFeedController", () => {
    let controller: ActivitiesFeedController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [ActivitiesFeedController],
            providers: [
                {
                    provide: ActivitiesFeedService,
                    useValue: {},
                },
                {
                    provide: CACHE_MANAGER,
                    useValue: {},
                },
            ],
        }).compile();

        controller = module.get<ActivitiesFeedController>(
            ActivitiesFeedController,
        );
    });

    it("should be defined", () => {
        expect(controller).toBeDefined();
    });
});
