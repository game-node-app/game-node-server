import { Test, TestingModule } from "@nestjs/testing";
import { LibrariesService } from "./libraries.service";
import { getMockRepositoryProvider } from "../../test/mocks/repositoryMocks";
import { Library } from "./entities/library.entity";

describe("LibrariesService", () => {
    let service: LibrariesService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [getMockRepositoryProvider(Library), LibrariesService],
        }).compile();

        service = module.get<LibrariesService>(LibrariesService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });
});
