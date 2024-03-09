import { Test, TestingModule } from "@nestjs/testing";
import { FollowService } from "./follow.service";
import { getMockRepositoryProvider } from "../../test/mocks/repositoryMocks";
import { UserFollow } from "./entity/user-follow.entity";
import Mocked = jest.Mocked;
import { Repository } from "typeorm";
import { getRepositoryToken } from "@nestjs/typeorm";

describe("FollowService", () => {
    let service: FollowService;
    let repository: Mocked<Repository<UserFollow>>;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [FollowService, getMockRepositoryProvider(UserFollow)],
        }).compile();

        service = module.get<FollowService>(FollowService);
        repository = module.get(getRepositoryToken(UserFollow));
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });

    it("should register follow", async () => {
        const followerId = "54321";
        const followedId = "12345";
        await service.registerFollow(followerId, followedId);
        expect(repository.save).toHaveBeenCalledWith({
            followed: {
                userId: followedId,
            },
            follower: {
                userId: followerId,
            },
        } as UserFollow);
    });

    it("should remove follow", async () => {
        const followerId = "54321";
        const followedId = "12345";
        await service.removeFollow(followerId, followedId);
        expect(repository.delete).toHaveBeenCalledWith({
            followed: {
                userId: followedId,
            },
            follower: {
                userId: followerId,
            },
        } as UserFollow);
    });
});
