import { CollectionEntry } from "../entities/collection-entry.entity";

export class FindRelatedCollectionEntriesResponseDto {
    dlcs: CollectionEntry[];
    expansions: CollectionEntry[];
}
