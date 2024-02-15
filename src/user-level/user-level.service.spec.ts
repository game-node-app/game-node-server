import { Test, TestingModule } from "@nestjs/testing";
import { UserLevelService } from "./user-level.service";
import { getMockRepositoryProvider } from "../../test/mocks/repositoryMocks";
import { UserLevel } from "./entities/user-level.entity";
import Mocked = jest.Mocked;
import { DeepPartial, Repository } from "typeorm";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Profile } from "../profile/entities/profile.entity";

function getMockUserLevel() {
    const mockUserLevel = new UserLevel();
    mockUserLevel.currentLevel = 1;
    mockUserLevel.currentLevelExp = 0;
    mockUserLevel.levelUpExpCost = 100;
    mockUserLevel.expMultiplier = 1;
    mockUserLevel.profile = {
        userId: "12345",
    } as Profile;
    return mockUserLevel;
}

describe("UserLevelService", () => {
    let service: UserLevelService;
    let repository: Mocked<Repository<UserLevel>>;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [getMockRepositoryProvider(UserLevel), UserLevelService],
        }).compile();

        service = module.get<UserLevelService>(UserLevelService);
        repository = module.get(getRepositoryToken(UserLevel));
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });

    it("should increase exp without increasing user-level", async () => {
        const mockUserLevel = getMockUserLevel();
        repository.findOne.mockResolvedValue(mockUserLevel);
        repository.create.mockReturnValueOnce(mockUserLevel);
        await service.increaseExp(mockUserLevel.profile.userId, 50);
        expect(repository.save).toHaveBeenCalledWith(
            expect.objectContaining({
                currentLevel: 1,
                currentLevelExp: 50,
            } satisfies Partial<UserLevel>),
        );
    });

    it("should increase user-level when exp reaches threshold", async () => {
        const mockUserLevel = structuredClone(getMockUserLevel());
        repository.findOne.mockResolvedValueOnce(mockUserLevel);
        repository.create.mockReturnValueOnce(mockUserLevel);
        await service.increaseExp(
            mockUserLevel.profile.userId,
            mockUserLevel.levelUpExpCost,
        );
        expect(repository.save).toHaveBeenCalledWith(
            expect.objectContaining({
                currentLevel: mockUserLevel.currentLevel + 1,
            } satisfies Partial<UserLevel>),
        );
    });

    it("should increase user-level multiple times when exp reaches threshold multiple times", async () => {
        const minimumLevelUpIncrease = 2;
        const mockUserLevel = getMockUserLevel();
        const expAmount = 1000;
        repository.findOne.mockResolvedValueOnce(
            structuredClone(mockUserLevel),
        );
        repository.create.mockReturnValueOnce(structuredClone(mockUserLevel));
        let finalResult: DeepPartial<UserLevel> = {};
        repository.save.mockImplementation(async (entity) => {
            finalResult = entity;
            return entity as DeepPartial<UserLevel> & UserLevel;
        });
        await service.increaseExp(mockUserLevel.profile.userId, expAmount);

        expect(finalResult.currentLevel).toBeGreaterThan(
            mockUserLevel.currentLevel + minimumLevelUpIncrease,
        );
        expect(finalResult.levelUpExpCost).toBeGreaterThan(
            mockUserLevel.levelUpExpCost,
        );
    });
});
