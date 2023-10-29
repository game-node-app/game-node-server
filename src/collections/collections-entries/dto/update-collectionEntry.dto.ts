import { OmitType, PartialType } from "@nestjs/swagger";
import { CreateCollectionEntryDto } from "./create-collection-entry.dto";
import { Transform } from "class-transformer";

export class UpdateCollectionEntryDto extends PartialType(
    OmitType(CreateCollectionEntryDto, ["gameId"]),
) {}
