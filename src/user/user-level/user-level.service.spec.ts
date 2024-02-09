import { Test, TestingModule } from "@nestjs/testing";
import { UserLevelService } from "./user-level.service";
import { getMockRepositoryProvider } from "../../../test/mocks/repositoryMocks";
import { UserLevel } from "./entities/user-level.entity";

describe("UserLevelService", () => {
    let service: UserLevelService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [getMockRepositoryProvider(UserLevel), UserLevelService],
        }).compile();

        service = module.get<UserLevelService>(UserLevelService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });
});
