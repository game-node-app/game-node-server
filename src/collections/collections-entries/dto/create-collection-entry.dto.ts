import {
    IsArray,
    IsBoolean,
    IsDate,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
} from "class-validator";

export class CreateCollectionEntryDto {
    @IsNotEmpty()
    @IsArray()
    @IsString({ each: true })
    collectionIds: string[];
    @IsNotEmpty()
    @IsNumber()
    gameId: number;
    @IsArray()
    @IsNotEmpty()
    @IsNumber(undefined, { each: true })
    platformIds: number[];
    @IsBoolean()
    isFavorite: boolean = false;
    @IsOptional()
    @IsDate()
    finishedAt?: Date;
}
