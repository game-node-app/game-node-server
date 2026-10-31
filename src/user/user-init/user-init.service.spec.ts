import { Test, TestingModule } from "@nestjs/testing";
import { UserInitService } from "./user-init.service";
import { CollectionsService } from "../../collections/collections.service";
import { LibrariesService } from "../../libraries/libraries.service";
import { ProfileService } from "../../profile/profile.service";
import { LevelService } from "../../level/level.service";
import Mocked = jest.Mocked;

const mockUserId = "1234";

describe("UserInitService", () => {
    let service: UserInitService;
    let librariesService: Mocked<LibrariesService>;
    let profileService: Mocked<ProfileService>;
    let levelService: Mocked<LevelService>;
    let moduleCollectionsCreate: jest.Mock;

    beforeEach(async () => {
        moduleCollectionsCreate = jest.fn();
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                UserInitService,
                {
                    provide: CollectionsService,
                    useValue: {
                        findOneById: jest.fn(),
                        create: moduleCollectionsCreate,
                    },
                },
                {
                    provide: LibrariesService,
                    useValue: {
                        findOneById: jest.fn(),
                        create: jest.fn(),
                    },
                },
                {
                    provide: ProfileService,
                    useValue: {
                        findOneById: jest.fn(),
                        create: jest.fn(),
                    },
                },
                {
                    provide: LevelService,
                    useValue: {
                        findOneOrCreateByUserId: jest.fn(),
                    },
                },
            ],
        }).compile();

        service = module.get<UserInitService>(UserInitService);
        librariesService = module.get(LibrariesService);
        profileService = module.get(ProfileService);
        levelService = module.get(LevelService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });

    it("should create a user library", async () => {
        librariesService.findOneById.mockResolvedValueOnce(null);
        await service.init(mockUserId);
        expect(librariesService.create).toHaveBeenCalledWith(mockUserId);
    });

    it("should not create collections for a new user", async () => {
        librariesService.findOneById.mockResolvedValueOnce(null);
        await service.init(mockUserId);
        expect(moduleCollectionsCreate).not.toHaveBeenCalled();
    });

    it("should create a user profile", async () => {
        profileService.findOneById.mockResolvedValueOnce(null);
        await service.init(mockUserId);
        expect(profileService.create).toHaveBeenCalledWith(mockUserId);
    });

    it("should ensure a user level after the profile", async () => {
        profileService.findOneById.mockResolvedValueOnce(null);
        await service.init(mockUserId);
        expect(levelService.findOneOrCreateByUserId).toHaveBeenCalledWith(
            mockUserId,
        );
        expect(profileService.create.mock.invocationCallOrder[0]).toBeLessThan(
            levelService.findOneOrCreateByUserId.mock.invocationCallOrder[0],
        );
    });

    it("should create nothing new on a second init", async () => {
        profileService.findOneById
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ userId: mockUserId } as never);
        librariesService.findOneById
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ userId: mockUserId } as never);
        await service.init(mockUserId);
        await service.init(mockUserId);
        expect(profileService.create).toHaveBeenCalledTimes(1);
        expect(librariesService.create).toHaveBeenCalledTimes(1);
    });
});
