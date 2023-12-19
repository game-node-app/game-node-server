import { Test, TestingModule } from "@nestjs/testing";
import { UserLevelController } from "./user-level.controller";
import { UserLevelService } from "./user-level.service";

describe("UserLevelController", () => {
    let controller: UserLevelController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [UserLevelController],
            providers: [UserLevelService],
        }).compile();

        controller = module.get<UserLevelController>(UserLevelController);
    });

    it("should be defined", () => {
        expect(controller).toBeDefined();
    });
});
