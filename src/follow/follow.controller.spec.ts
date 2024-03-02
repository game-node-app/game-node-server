import { Test, TestingModule } from "@nestjs/testing";
import { FollowController } from "./follow.controller";
import { FollowService } from "./follow.service";

describe("FollowController", () => {
    let controller: FollowController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                {
                    provide: FollowService,
                    useValue: {},
                },
            ],
            controllers: [FollowController],
        }).compile();

        controller = module.get<FollowController>(FollowController);
    });

    it("should be defined", () => {
        expect(controller).toBeDefined();
    });
});
