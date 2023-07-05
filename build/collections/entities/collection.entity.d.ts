import { Library } from "../../libraries/entities/library.entity";
import { CollectionEntry } from "./collectionEntry.entity";
export declare class Collection {
    id: string;
    name: string;
    description: string;
    isPublic: boolean;
    library: Library;
    entries: CollectionEntry[];
}
