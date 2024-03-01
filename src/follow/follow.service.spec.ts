import { Test, TestingModule } from "@nestjs/testing";
import { FollowService } from "./follow.service";
import { getMockRepositoryProvider } from "../../test/mocks/repositoryMocks";
import { UserFollow } from "./entity/user-follow.entity";

describe("FollowService", () => {
    let service: FollowService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [FollowService, getMockRepositoryProvider(UserFollow)],
        }).compile();

        service = module.get<FollowService>(FollowService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });
});
