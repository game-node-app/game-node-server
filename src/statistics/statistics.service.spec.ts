import { Test, TestingModule } from "@nestjs/testing";
import { StatisticsService } from "./statistics.service";
import { getMockRepositoriesProviders } from "../../test/mocks/repositoryMocks";
import { Statistics } from "./entity/statistics.entity";
import { UserLike } from "./entity/user-like.entity";
import { UserView } from "./entity/user-view.entity";
import { Notification } from "../notifications/entity/notification.entity";

describe("StatisticsService", () => {
    let service: StatisticsService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                StatisticsService,
                ...getMockRepositoriesProviders([
                    Statistics,
                    UserLike,
                    UserView,
                    Notification,
                ]),
            ],
        }).compile();

        service = module.get<StatisticsService>(StatisticsService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });
});
