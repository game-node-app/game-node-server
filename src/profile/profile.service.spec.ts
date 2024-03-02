import { Test, TestingModule } from "@nestjs/testing";
import { ProfileService } from "./profile.service";
import { getMockRepositoriesProviders } from "../../test/mocks/repositoryMocks";
import { Profile } from "./entities/profile.entity";
import { ProfileAvatar } from "./entities/profile-avatar.entity";

describe("ProfileService", () => {
    let service: ProfileService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ProfileService,
                ...getMockRepositoriesProviders([Profile, ProfileAvatar]),
            ],
        }).compile();

        service = module.get<ProfileService>(ProfileService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });
});
