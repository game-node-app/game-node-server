import { Test, TestingModule } from "@nestjs/testing";
import { AchievementsController } from "./achievements.controller";
import { AchievementsService } from "./achievements.service";
import { getMockRepositoryProvider } from "../../test/mocks/repositoryMocks";
import { ObtainedAchievement } from "./entities/obtained-achievement.entity";

describe("AchievementsController", () => {
    let controller: AchievementsController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [AchievementsController],
            providers: [
                getMockRepositoryProvider(ObtainedAchievement),
                { provide: AchievementsService, useValue: {} },
            ],
        }).compile();

        controller = module.get<AchievementsController>(AchievementsController);
    });

    it("should be defined", () => {
        expect(controller).toBeDefined();
    });
});
