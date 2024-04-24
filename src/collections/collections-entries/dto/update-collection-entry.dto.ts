import { PartialType, PickType } from "@nestjs/swagger";
import { CreateCollectionEntryDto } from "./create-collection-entry.dto";
import { IsString, Length } from "class-validator";

export class UpdateCollectionEntryDto extends PartialType(
    PickType(CreateCollectionEntryDto, ["isFavorite", "finishedAt"]),
) {}
