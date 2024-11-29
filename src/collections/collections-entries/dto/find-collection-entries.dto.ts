import { CollectionEntry } from "../entities/collection-entry.entity";
import { BaseFindDto } from "../../../utils/base-find.dto";
import { OmitType } from "@nestjs/swagger";
import { FindCollectionEntriesOrderBy } from "./collection-entries-order-by.dto";

export class FindCollectionEntriesDto extends OmitType(
    BaseFindDto<CollectionEntry>,
    ["search", "orderBy"],
) {
    orderBy?: FindCollectionEntriesOrderBy;
}
