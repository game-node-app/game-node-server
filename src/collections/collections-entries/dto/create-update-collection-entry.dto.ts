import {
    IsArray,
    IsBoolean,
    IsDate,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
} from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

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
    @IsDate()
    @ApiProperty({
        type: "date-time",
    })
    finishedAt?: Date;
}
