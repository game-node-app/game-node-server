import { OmitType } from "@nestjs/swagger";
import { FindCollectionEntriesDto } from "./find-collection-entries.dto";

export class FindFavoriteCollectionEntriesDto extends OmitType(
    FindCollectionEntriesDto,
    ["gameFilters"],
) {}
