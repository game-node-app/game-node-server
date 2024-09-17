import { OmitType } from "@nestjs/swagger";
import { FindCollectionEntriesDto } from "./find-collection-entries.dto";

export class FindCollectionEntriesForCollectionIdOrderBy {
    addedDate?: "ASC" | "DESC";
    releaseDate?: "ASC" | "DESC";
}

export class FindCollectionEntriesForCollectionIdDto extends OmitType(
    FindCollectionEntriesDto,
    ["orderBy"],
) {
    orderBy?: FindCollectionEntriesForCollectionIdOrderBy;
}
