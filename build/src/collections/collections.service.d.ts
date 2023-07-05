import { Collection } from "./entities/collection.entity";
import { Repository } from "typeorm";
import { CreateCollectionDto } from "./dto/create-collection.dto";
import { LibrariesService } from "../libraries/libraries.service";
import { IgdbService } from "../igdb/igdb.service";
import { CreateCollectionEntryDto } from "./dto/create-collectionEntry.dto";
import { CollectionEntry } from "./entities/collectionEntry.entity";
import { UpdateCollectionDto } from "./dto/update-collection.dto";
export declare class CollectionsService {
    private collectionsRepository;
    private collectionEntriesRepository;
    private readonly librariesService;
    private readonly igdbService;
    constructor(collectionsRepository: Repository<Collection>, collectionEntriesRepository: Repository<CollectionEntry>, librariesService: LibrariesService, igdbService: IgdbService);
    findOneById(id: string): Promise<Collection | null>;
    findOneEntryById(id: number): Promise<CollectionEntry | null>;
    findOneEntryByIgdbId(igdbId: number): Promise<CollectionEntry | null>;
    findOneByIdOrFail(id: string): Promise<Collection>;
    create(userId: string, createCollectionDto: CreateCollectionDto): Promise<Collection>;
    update(id: string, updateCollectionDto: UpdateCollectionDto): Promise<Collection>;
    createEntry(collectionId: string, createEntryDto: CreateCollectionEntryDto): Promise<CollectionEntry>;
}
