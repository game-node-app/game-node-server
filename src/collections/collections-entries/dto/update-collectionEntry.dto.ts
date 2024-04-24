import { OmitType, PartialType } from "@nestjs/swagger";
import { CreateCollectionEntryDto } from "./create-collection-entry.dto";

export class UpdateCollectionEntryDto extends PartialType(
    OmitType(CreateCollectionEntryDto, ["gameId"]),
) {}
