import { OmitType, PartialType } from "@nestjs/swagger";
import { CreateCollectionEntryDto } from "./create-collectionEntry.dto";

export class UpdateCollectionEntryDto extends PartialType(
    OmitType(CreateCollectionEntryDto, ["igdbId"]),
) {}
