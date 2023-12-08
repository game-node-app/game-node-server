import { Test, TestingModule } from "@nestjs/testing";
import { ActivitiesFeedService } from "./activities-feed.service";

describe("ActivitiesFeedService", () => {
    let service: ActivitiesFeedService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [ActivitiesFeedService],
        }).compile();

        service = module.get<ActivitiesFeedService>(ActivitiesFeedService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });

    it("should return an activites feed", () => {});
});
