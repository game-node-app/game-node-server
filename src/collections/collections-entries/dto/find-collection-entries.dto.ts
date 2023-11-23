import { CollectionEntry } from "../entities/collection-entry.entity";
import { BaseFindDto } from "../../../utils/base-find.dto";
import { OmitType } from "@nestjs/swagger";

export class FindCollectionEntriesDto extends OmitType(
    BaseFindDto<CollectionEntry>,
    ["search"],
) {}
