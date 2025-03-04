import {
    IsDateString,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
} from "class-validator";

export class BaseCursorFindDto {
    @IsOptional()
    @IsDateString()
    lastCreatedAt?: string; // ISO Date format
    @IsOptional()
    @IsString()
    lastId?: string; // UUID of the last entry
    @IsOptional()
    @IsNumber()
    @IsNotEmpty()
    limit?: number = 20;
}
