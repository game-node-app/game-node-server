import { Test, TestingModule } from "@nestjs/testing";
import { ProfileController } from "./profile.controller";
import { ProfileService } from "./profile.service";
import { AuthService } from "../auth/auth.service";

describe("ProfileController", () => {
    let controller: ProfileController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [ProfileController],
            providers: [
                { provide: AuthService, useValue: {} },
                {
                    provide: ProfileService,
                    useValue: {},
                },
            ],
        }).compile();

        controller = module.get<ProfileController>(ProfileController);
    });

    it("should be defined", () => {
        expect(controller).toBeDefined();
    });
});
