import { CollectionsService } from "./collections.service";
import { CreateCollectionDto } from "./dto/create-collection.dto";
import { SessionContainer } from "supertokens-node/recipe/session";
import { CreateCollectionEntryDto } from "./dto/create-collectionEntry.dto";
import { FindCollectionEntryDto } from "./dto/find-collection-entry.dto";
export declare class CollectionsController {
    private readonly collectionsService;
    constructor(collectionsService: CollectionsService);
    findOneById(id: string): Promise<import("./entities/collection.entity").Collection | null>;
    create(session: SessionContainer, createCollectionDto: CreateCollectionDto): Promise<import("./entities/collection.entity").Collection>;
    getEntries(collectionId: string, findEntryDto: FindCollectionEntryDto): Promise<import("./entities/collectionEntry.entity").CollectionEntry | null>;
    addEntry(collectionId: string, createCollectionEntryDto: CreateCollectionEntryDto): Promise<import("./entities/collectionEntry.entity").CollectionEntry>;
}
