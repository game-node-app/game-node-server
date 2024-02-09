import { Test, TestingModule } from "@nestjs/testing";
import { CollectionsController } from "./collections.controller";
import { CollectionsService } from "./collections.service";
import { AuthGuard } from "../auth/auth.guard";
import { CACHE_MANAGER, CacheModule } from "@nestjs/cache-manager";

describe("CollectionsController", () => {
    let controller: CollectionsController;
    let service: CollectionsService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [CollectionsController],
            providers: [
                {
                    provide: CollectionsService,
                    useValue: {
                        findOneById: jest.fn(),
                        create: jest.fn(),
                        findOneEntryById: jest.fn(),
                        findOneEntryByIgdbId: jest.fn(),
                        createEntry: jest.fn(),
                    },
                },
                {
                    provide: AuthGuard,
                    useValue: jest.fn(),
                },
                {
                    provide: CacheModule,
                    useValue: jest.fn(),
                },
                {
                    provide: CACHE_MANAGER,
                    useValue: CACHE_MANAGER,
                },
            ],
        }).compile();

        controller = module.get<CollectionsController>(CollectionsController);
        service = module.get<CollectionsService>(CollectionsService);
    });

    it("should be defined", () => {
        expect(controller).toBeDefined();
        expect(service).toBeDefined();
    });
});
