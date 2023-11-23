import { PaginationInfo } from "../../../utils/pagination/pagination-response.dto";
import { CollectionEntry } from "../entities/collection-entry.entity";

export class CollectionEntriesPaginatedResponseDto {
    data: CollectionEntry[];
    pagination: PaginationInfo;
}
