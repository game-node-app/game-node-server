import { Test, TestingModule } from "@nestjs/testing";
import { UserLevelService } from "./user-level.service";

describe("UserLevelService", () => {
    let service: UserLevelService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [UserLevelService],
        }).compile();

        service = module.get<UserLevelService>(UserLevelService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });
});
