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
import { MaxListSize } from "../../../utils/request-bounds";

export class CreateUpdateCollectionEntryDto {
    @IsNotEmpty()
    @IsArray()
    @IsString({ each: true })
    @MaxListSize()
    collectionIds: string[];
    @IsNotEmpty()
    @IsNumber()
    gameId: number;
    @IsOptional()
    @IsArray()
    @IsNumber(undefined, { each: true })
    @MaxListSize()
    relatedGameIds?: number[];
    @IsArray()
    @IsNotEmpty()
    @IsNumber(undefined, { each: true })
    @MaxListSize()
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
