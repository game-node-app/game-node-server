import { Test, TestingModule } from "@nestjs/testing";
import { FollowController } from "./follow.controller";
import { FollowService } from "./follow.service";
import { AuthService } from "../auth/auth.service";

describe("FollowController", () => {
    let controller: FollowController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                { provide: AuthService, useValue: {} },
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
