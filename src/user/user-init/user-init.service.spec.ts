import { Test, TestingModule } from "@nestjs/testing";
import { UserInitService } from "./user-init.service";
import { CollectionsService } from "../../collections/collections.service";
import { LibrariesService } from "../../libraries/libraries.service";
import Mocked = jest.Mocked;
import { ProfileService } from "../../profile/profile.service";
import { UserLevelService } from "../user-level/user-level.service";

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
                        findOneById: jest.fn(),
                        create: jest.fn(),
                    },
                },
            ],
        }).compile();

        service = module.get<UserInitService>(UserInitService);
        librariesService = module.get(LibrariesService);
        profileService = module.get(ProfileService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });

    it("should create a user library", async () => {
        const userId = "1235";
        librariesService.findOneById.mockResolvedValueOnce(null);
        await service.init(userId);
        expect(librariesService.create).toHaveBeenCalledWith(userId);
    });

    it("should create a user profile", async () => {
        const userId = "1235";
        profileService.findOneById.mockResolvedValueOnce(null);
        await service.init(userId);
        expect(profileService.create).toHaveBeenCalledWith(userId);
    });
});
