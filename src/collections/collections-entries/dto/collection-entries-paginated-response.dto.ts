import { CollectionEntry } from "../entities/collection-entry.entity";
import { PaginationInfo } from "../../../utils/pagination/pagination-response.dto";

export class CollectionEntriesPaginatedResponseDto {
    data: CollectionEntry[];
    pagination: PaginationInfo;
}
