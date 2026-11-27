import { FindCollectionEntriesDto } from "./find-collection-entries.dto";
import {
    ClampLimit,
    MAX_LARGE_PAGE_LIMIT,
} from "../../../utils/request-bounds";

export class FindCollectionEntriesForCollectionIdDto extends FindCollectionEntriesDto {
    // The release calendar, collection move form and admin achievement list load a whole set at once.
    @ClampLimit(MAX_LARGE_PAGE_LIMIT)
    limit?: number = 20;
}
