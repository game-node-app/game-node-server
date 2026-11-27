import {
    IsDateString,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
} from "class-validator";
import { ClampLimit, MAX_PAGE_LIMIT } from "./request-bounds";

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
    @ClampLimit(MAX_PAGE_LIMIT)
    limit?: number = 20;
}
