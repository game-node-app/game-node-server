import {
    IsArray,
    IsEnum,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
} from "class-validator";
import { CollectionEntryStatus } from "../collections-entries.constants";
import { LibraryVisibility } from "../../../libraries/library-visibility.constants";

export class CreateUpdateCollectionEntryDto {
    @IsNotEmpty()
    @IsArray()
    @IsString({ each: true })
    collectionIds: string[];
    @IsNotEmpty()
    @IsNumber()
    gameId: number;
    @IsOptional()
    @IsArray()
    @IsNumber(undefined, { each: true })
    relatedGameIds?: number[];
    @IsArray()
    @IsNotEmpty()
    @IsNumber(undefined, { each: true })
    platformIds: number[];
    @IsOptional()
    finishedAt?: Date | null;
    @IsNotEmpty()
    @IsString()
    status: CollectionEntryStatus;
    @IsOptional()
    @IsEnum(LibraryVisibility)
    visibility?: LibraryVisibility;
}
