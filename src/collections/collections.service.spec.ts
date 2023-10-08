import { Test, TestingModule } from "@nestjs/testing";
import { CollectionsService } from "./collections.service";
import { LibrariesService } from "../libraries/libraries.service";
import { IgdbService } from "../igdb/igdb.service";
import { HttpException, HttpStatus } from "@nestjs/common";
import { Collection } from "./entities/collection.entity";
import { CollectionEntry } from "./entities/collection-entry.entity";
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
});
