import { Test, TestingModule } from "@nestjs/testing";
import { CollectionsService } from "./collections.service";
import { LibrariesService } from "../libraries/libraries.service";
import { IgdbService } from "../igdb/igdb.service";
import { HttpException, HttpStatus } from "@nestjs/common";
import { Collection } from "./entities/collection.entity";
import { CollectionEntry } from "./entities/collectionEntry.entity";
import { CreateCollectionDto } from "./dto/create-collection.dto";
import { CreateCollectionEntryDto } from "./dto/create-collectionEntry.dto";
import { UpdateCollectionDto } from "./dto/update-collection.dto";
import { Library } from "../libraries/entities/library.entity";

describe("CollectionsService", () => {
    let service: CollectionsService;
    let librariesService: LibrariesService;
    let igdbService: IgdbService;
    let collectionsRepository: any;
    let collectionEntriesRepository: any;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CollectionsService,
                {
                    provide: LibrariesService,
                    useValue: {
                        findByUserId: jest.fn(),
                    },
                },
                {
                    provide: IgdbService,
                    useValue: {
                        findByIdsOrFail: jest.fn(),
                    },
                },
                {
                    provide: "CollectionRepository",
                    useValue: {
                        findOne: jest.fn(),
                        create: jest.fn(),
                        save: jest.fn(),
                    },
                },
                {
                    provide: "CollectionEntryRepository",
                    useValue: {
                        findOne: jest.fn(),
                        create: jest.fn(),
                        save: jest.fn(),
                    },
                },
            ],
        }).compile();

        service = module.get<CollectionsService>(CollectionsService);
        librariesService = module.get<LibrariesService>(LibrariesService);
        igdbService = module.get<IgdbService>(IgdbService);
        collectionsRepository = module.get("CollectionRepository");
        collectionEntriesRepository = module.get("CollectionEntryRepository");
    });

    describe("findOneById", () => {
        it("should call the collectionsRepository's findOne method with the correct argument", async () => {
            const mockId = "testId";
            await service.findOneById(mockId);
            expect(collectionsRepository.findOne).toHaveBeenCalledWith({
                where: { id: mockId },
                relations: { entries: true, library: true },
            });
        });
    });

    describe("findOneEntryById", () => {
        it("should call the collectionEntriesRepository's findOne method with the correct argument", async () => {
            const mockId = 1;
            await service.findOneEntryById(mockId);
            expect(collectionEntriesRepository.findOne).toHaveBeenCalledWith({
                where: { id: mockId },
                relations: { collection: true },
            });
        });
    });

    describe("findOneEntryByIgdbId", () => {
        it("should call the collectionEntriesRepository's findOne method with the correct argument", async () => {
            const mockIgdbId = 1;
            await service.findOneEntryByIgdbId(mockIgdbId);
            expect(collectionEntriesRepository.findOne).toHaveBeenCalledWith({
                where: { data: { igdbId: mockIgdbId } },
                relations: { collection: true },
            });
        });
    });

    describe("findOneByIdOrFail", () => {
        it("should throw HttpException with HttpStatus.NOT_FOUND if collection is not found", async () => {
            const mockId = "testId";
            collectionsRepository.findOne.mockResolvedValueOnce(undefined);

            await expect(service.findOneByIdOrFail(mockId)).rejects.toThrow(
                new HttpException(
                    "Collection not found.",
                    HttpStatus.NOT_FOUND,
                ),
            );
        });
    });

    describe("create", () => {
        it("should throw HttpException with HttpStatus.PRECONDITION_REQUIRED if user has no library defined", async () => {
            const mockUserId = "testUserId";
            const mockCreateCollectionDto: CreateCollectionDto = {
                name: "testName",
                description: "testDescription",
            };
            jest.spyOn(librariesService, "findOneById").mockResolvedValueOnce(
                null,
            );

            await expect(
                service.create(mockUserId, mockCreateCollectionDto),
            ).rejects.toThrow(
                new HttpException(
                    "User has no library defined.",
                    HttpStatus.PRECONDITION_REQUIRED,
                ),
            );
        });

        it("should throw HttpException with HttpStatus.INTERNAL_SERVER_ERROR if an error occurs during saving", async () => {
            const mockUserId = "testUserId";
            const mockCreateCollectionDto: CreateCollectionDto = {
                name: "testName",
                description: "testDescription",
            };
            const mockUserLibrary = { id: "testLibraryId" };
            jest.spyOn(librariesService, "findOneById").mockRejectedValueOnce(
                mockUserLibrary,
            );

            jest.spyOn(collectionsRepository, "save").mockRejectedValueOnce(
                new Error("Test"),
            );

            await expect(
                service.create(mockUserId, mockCreateCollectionDto),
            ).rejects.toThrow(HttpException);
        });
    });

    describe("update", () => {
        it("should throw HttpException with HttpStatus.INTERNAL_SERVER_ERROR if an error occurs during saving", async () => {
            const mockId = "testId";
            const mockUpdateCollectionDto: UpdateCollectionDto = {};
            const mockCollection = { id: mockId, name: "Old Name" };
            const mockUpdatedCollection = {
                ...mockCollection,
                ...mockUpdateCollectionDto,
            };
            const findOneByIdOrFailSpy = jest.spyOn(
                service,
                "findOneByIdOrFail",
            );
            jest.spyOn(collectionsRepository, "save").mockRejectedValueOnce(
                new Error("Test error"),
            );
            jest.spyOn(collectionsRepository, "create").mockReturnValueOnce(
                mockUpdatedCollection,
            );

            await expect(
                service.update(mockId, mockUpdateCollectionDto),
            ).rejects.toThrow(HttpException);
        });
    });

    describe("createEntry", () => {
        it("should call the findOneByIdOrFail method with the correct argument", async () => {
            const mockCollectionId = "testCollectionId";
            const mockCreateEntryDto: CreateCollectionEntryDto = {
                igdbId: 1,
            };
            const findOneByIdOrFailSpy = jest
                .spyOn(service, "findOneByIdOrFail")
                .mockResolvedValueOnce({
                    name: "testName",
                    description: "testDescription",
                    entries: [],
                    library: {
                        id: "testLibraryId",
                        userId: "testUserId",
                        collections: [],
                    },
                    id: mockCollectionId,
                    isPublic: false,
                });
            jest.spyOn(igdbService, "findByIdsOrFail").mockResolvedValueOnce(
                [],
            );

            await service.createEntry(mockCollectionId, mockCreateEntryDto);

            expect(findOneByIdOrFailSpy).toHaveBeenCalledWith(mockCollectionId);
        });

        it("should call the igdbService's findByIdsOrFail method with the correct arguments", async () => {
            const mockCollectionId = "testCollectionId";
            const mockCreateEntryDto: CreateCollectionEntryDto = { igdbId: 1 };
            const mockCollection = {
                name: "testName",
                description: "testDescription",
                entries: [],
                library: {
                    id: "testLibraryId",
                    userId: "testUserId",
                    collections: [],
                },
                id: mockCollectionId,
                isPublic: false,
            };
            const findByIdsOrFailSpy = jest.spyOn(
                igdbService,
                "findByIdsOrFail",
            );
            jest.spyOn(service, "findOneByIdOrFail").mockResolvedValueOnce(
                mockCollection,
            );
            jest.spyOn(igdbService, "findByIdsOrFail").mockResolvedValueOnce(
                [],
            );

            await service.createEntry(mockCollectionId, mockCreateEntryDto);

            expect(findByIdsOrFailSpy).toHaveBeenCalledWith({
                igdbIds: [mockCreateEntryDto.igdbId],
            });
        });

        it("should throw HttpException with HttpStatus.INTERNAL_SERVER_ERROR if an error occurs during saving", async () => {
            const mockCollectionId = "testCollectionId";
            const mockCreateEntryDto: CreateCollectionEntryDto = { igdbId: 1 };
            const mockCollection = {
                name: "testName",
                description: "testDescription",
                entries: [],
                library: {
                    id: "testLibraryId",
                    userId: "testUserId",
                    collections: [],
                },
                id: mockCollectionId,
                isPublic: false,
            };
            const mockGames = [{ id: 1 }];
            const mockCollectionEntry = {
                data: mockGames[0],
                collection: mockCollection,
            };
            const createSpy = jest.spyOn(collectionEntriesRepository, "create");
            jest.spyOn(
                collectionEntriesRepository,
                "save",
            ).mockRejectedValueOnce(new Error("Test error"));
            jest.spyOn(service, "findOneByIdOrFail").mockResolvedValueOnce(
                mockCollection,
            );
            jest.spyOn(igdbService, "findByIdsOrFail").mockResolvedValueOnce(
                [],
            );

            await expect(
                service.createEntry(mockCollectionId, mockCreateEntryDto),
            ).rejects.toThrow(HttpException);
        });
    });
});
