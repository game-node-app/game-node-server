import { Test, TestingModule } from "@nestjs/testing";
import { LibrariesService } from "../libraries/libraries.service";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Library } from "../libraries/entities/library.entity";
import { HttpException, HttpStatus } from "@nestjs/common";

describe("LibrariesService", () => {
    let service: LibrariesService;
    let libraryRepositoryMock: any;

    beforeEach(async () => {
        libraryRepositoryMock = {
            findOne: jest.fn(),
            findOneBy: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                LibrariesService,
                {
                    provide: getRepositoryToken(Library),
                    useValue: libraryRepositoryMock,
                },
            ],
        }).compile();

        service = module.get<LibrariesService>(LibrariesService);
    });

    describe("findByUserId", () => {
        it("should call libraryRepository.findOne with the correct arguments", async () => {
            const mockUserId = "testUserId";
            await service.findOneById(mockUserId);
            expect(libraryRepositoryMock.findOne).toHaveBeenCalledWith({
                where: { userId: mockUserId },
                relations: service["relations"],
            });
        });
    });

    describe("findById", () => {
        it("should call libraryRepository.findOne with the correct arguments", async () => {
            const mockId = "testId";
            await service.findById(mockId);
            expect(libraryRepositoryMock.findOne).toHaveBeenCalledWith({
                where: { id: mockId },
                relations: service["relations"],
            });
        });
    });

    describe("create", () => {
        it("should throw an HttpException if user already has a library defined", async () => {
            const mockUserId = "testUserId";
            libraryRepositoryMock.findOneBy.mockReturnValueOnce({});

            await expect(service.create(mockUserId)).rejects.toThrowError(
                new HttpException(
                    "User already has a library defined.",
                    HttpStatus.BAD_REQUEST,
                ),
            );
        });

        it("should create and save a new library if the user does not have a library defined", async () => {
            const mockUserId = "testUserId";
            const mockCreatedLibrary = { userId: mockUserId };
            libraryRepositoryMock.findOneBy.mockReturnValueOnce(undefined);
            libraryRepositoryMock.create.mockReturnValueOnce(
                mockCreatedLibrary,
            );
            libraryRepositoryMock.save.mockReturnValueOnce(mockCreatedLibrary);

            const result = await service.create(mockUserId);

            expect(libraryRepositoryMock.create).toHaveBeenCalledWith({
                userId: mockUserId,
            });
            expect(libraryRepositoryMock.save).toHaveBeenCalledWith(
                mockCreatedLibrary,
            );
            expect(result).toEqual(mockCreatedLibrary);
        });

        it("should throw an HttpException with status 500 if an error occurs during saving", async () => {
            const mockUserId = "testUserId";
            const mockCreatedLibrary = { userId: mockUserId };
            libraryRepositoryMock.findOneBy.mockReturnValueOnce(undefined);
            libraryRepositoryMock.create.mockReturnValueOnce(
                mockCreatedLibrary,
            );
            libraryRepositoryMock.save.mockRejectedValueOnce(
                new Error("Error is thrown"),
            );

            await expect(service.create(mockUserId)).rejects.toThrowError(
                HttpException,
            );
        });
    });
});
