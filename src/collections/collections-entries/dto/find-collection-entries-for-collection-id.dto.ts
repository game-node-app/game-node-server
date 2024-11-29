import { OmitType } from "@nestjs/swagger";
import { FindCollectionEntriesDto } from "./find-collection-entries.dto";
import { FindCollectionEntriesOrderBy } from "./collection-entries-order-by.dto";

export class FindCollectionEntriesForCollectionIdDto extends OmitType(
    FindCollectionEntriesDto,
    ["orderBy"],
) {
    orderBy?: FindCollectionEntriesOrderBy;
}
