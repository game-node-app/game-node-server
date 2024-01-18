import { Test, TestingModule } from "@nestjs/testing";
import { UserInitService } from "./user-init.service";
import { CollectionsService } from "../../collections/collections.service";
import { LibrariesService } from "../../libraries/libraries.service";
import Mocked = jest.Mocked;
import { ProfileService } from "../../profile/profile.service";
import { UserLevelService } from "../user-level/user-level.service";

const mockUserId = "1234";

describe("UserInitService", () => {
    let service: UserInitService;
    let librariesService: Mocked<LibrariesService>;
    let profileService: Mocked<ProfileService>;
    let userLevelService: Mocked<UserLevelService>;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                UserInitService,
                {
                    provide: CollectionsService,
                    useValue: {
                        findOneById: jest.fn(),
                        create: jest.fn(async () => {}),
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
                    provide: UserLevelService,
                    useValue: {
                        findOneByUserId: jest.fn(),
                        findOneById: jest.fn(),
                        create: jest.fn(),
                    },
                },
            ],
        }).compile();

        service = module.get<UserInitService>(UserInitService);
        librariesService = module.get(LibrariesService);
        profileService = module.get(ProfileService);
        userLevelService = module.get(UserLevelService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });

    it("should create a user library", async () => {
        librariesService.findOneById.mockResolvedValueOnce(null);
        await service.init(mockUserId);
        expect(librariesService.create).toHaveBeenCalledWith(mockUserId);
    });

    it("should create a user profile", async () => {
        profileService.findOneById.mockResolvedValueOnce(null);
        await service.init(mockUserId);
        expect(profileService.create).toHaveBeenCalledWith(mockUserId);
    });

    it("should create a user level entity", async () => {
        userLevelService.findOneByUserId.mockResolvedValueOnce(null);
        await service.init(mockUserId);
        expect(userLevelService.create).toHaveBeenCalledWith(mockUserId);
    });
});
