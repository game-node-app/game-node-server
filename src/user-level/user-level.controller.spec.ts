import { Test, TestingModule } from "@nestjs/testing";
import { UserLevelController } from "./user-level.controller";
import { UserLevelService } from "./user-level.service";
import { getMockRepositoryProvider } from "../../test/mocks/repositoryMocks";
import { UserLevel } from "./entities/user-level.entity";

describe("UserLevelController", () => {
    let controller: UserLevelController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [UserLevelController],
            providers: [UserLevelService, getMockRepositoryProvider(UserLevel)],
        }).compile();

        controller = module.get<UserLevelController>(UserLevelController);
    });

    it("should be defined", () => {
        expect(controller).toBeDefined();
    });
});
