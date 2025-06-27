import {
    IsArray,
    IsBoolean,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
} from "class-validator";
import { CollectionEntryStatus } from "../collections-entries.constants";

export class CreateUpdateCollectionEntryDto {
    @IsNotEmpty()
    @IsArray()
    @IsString({ each: true })
    collectionIds: string[];
    @IsNotEmpty()
    @IsNumber()
    gameId: number;
    @IsArray()
    @IsNotEmpty()
    @IsNumber({}, { each: true })
    platformIds: number[];
    @IsOptional()
    @IsBoolean()
    isFavorite: boolean = false;
    @IsOptional()
    finishedAt?: Date | null;
    // TODO: Add validation after mobile updates
    // @IsNotEmpty()
    // @IsString()
    status: CollectionEntryStatus;
}
