import { Test, TestingModule } from "@nestjs/testing";
import { CollectionsController } from "./collections.controller";
import { CollectionsService } from "./collections.service";
import { AuthGuard } from "../auth/auth.guard";
import { SessionContainer } from "supertokens-node/recipe/session";
import { CreateCollectionDto } from "./dto/create-collection.dto";
import { FindCollectionEntryDto } from "./dto/find-collection-entry.dto";
import { CreateCollectionEntryDto } from "./dto/create-collectionEntry.dto";
import { HttpException, HttpStatus } from "@nestjs/common";
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

    describe("findOneById", () => {
        it("should call the collectionsService's findOneById method with the correct argument", async () => {
            const mockId = "testId";
            await controller.findOneById(mockId);
            expect(service.findOneById).toHaveBeenCalledWith(mockId);
        });
    });

    describe("create", () => {
        it("should call the collectionsService's create method with the correct arguments", async () => {
            const mockSession = {
                getUserId: jest.fn().mockReturnValue("testUserId"),
            } as unknown as SessionContainer;
            const mockCreateCollectionDto: CreateCollectionDto = {
                name: "testName",
                description: "testDescription",
            };

            await controller.create(mockSession, mockCreateCollectionDto);

            expect(service.create).toHaveBeenCalledWith(
                "testUserId",
                mockCreateCollectionDto,
            );
        });
    });

    describe("getEntries", () => {
        it("should call the collectionsService's findOneEntryById method if entryId is provided", async () => {
            const mockCollectionId = "testCollectionId";
            const mockFindEntryDto: FindCollectionEntryDto = {
                entryId: 5,
            };

            await controller.getEntries(mockCollectionId, mockFindEntryDto);

            expect(service.findOneEntryById).toHaveBeenCalledWith(
                mockFindEntryDto.entryId,
            );
        });

        it("should call the collectionsService's findOneEntryByIgdbId method if igdbId is provided", async () => {
            const mockCollectionId = "testCollectionId";
            const mockFindEntryDto: FindCollectionEntryDto = {
                igdbId: 5,
            };

            await controller.getEntries(mockCollectionId, mockFindEntryDto);

            expect(service.findOneEntryByIgdbId).toHaveBeenCalledWith(
                mockFindEntryDto.igdbId,
            );
        });

        it("should throw an HttpException with status 400 if neither entryId nor igdbId is provided", async () => {
            const mockCollectionId = "testCollectionId";
            const mockFindEntryDto: FindCollectionEntryDto = {};

            await expect(
                controller.getEntries(mockCollectionId, mockFindEntryDto),
            ).rejects.toThrowError(
                new HttpException(
                    "Invalid query. Either entryId or igdbId must be provided.",
                    HttpStatus.BAD_REQUEST,
                ),
            );
        });
    });

    describe("addEntry", () => {
        it("should call the collectionsService's createEntry method with the correct arguments", async () => {
            const mockCollectionId = "testCollectionId";
            const mockCreateCollectionEntryDto: CreateCollectionEntryDto = {
                igdbId: 5,
            };

            await controller.addEntry(
                mockCollectionId,
                mockCreateCollectionEntryDto,
            );

            expect(service.createEntry).toHaveBeenCalledWith(
                mockCollectionId,
                mockCreateCollectionEntryDto,
            );
        });
    });
});
