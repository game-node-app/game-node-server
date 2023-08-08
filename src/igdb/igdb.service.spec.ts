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
});
