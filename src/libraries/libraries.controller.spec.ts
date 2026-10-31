import { Test, TestingModule } from "@nestjs/testing";
import { LibrariesController } from "./libraries.controller";
import { LibrariesService } from "./libraries.service";
import { AuthGuard } from "../auth/auth.guard";
import { AuthService } from "../auth/auth.service";

describe("LibrariesController", () => {
    let controller: LibrariesController;
    let service: LibrariesService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [LibrariesController],
            providers: [
                { provide: AuthService, useValue: {} },
                {
                    provide: LibrariesService,
                    useValue: {
                        findByUserId: jest.fn(),
                        findById: jest.fn(),
                    },
                },
                {
                    provide: AuthGuard,
                    useValue: jest.fn(),
                },
            ],
        }).compile();

        controller = module.get<LibrariesController>(LibrariesController);
        service = module.get<LibrariesService>(LibrariesService);
    });

    it("should be defined", () => {
        expect(controller).toBeDefined();
        expect(service).toBeDefined();
    });
});
