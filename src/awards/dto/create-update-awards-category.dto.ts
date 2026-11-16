import {
    IsArray,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
    ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { AwardsCategoryTranslationInputDto } from "./awards-category-translation.dto";

export class CreateUpdateAwardsCategoryDto {
    @IsOptional()
    @IsNumber()
    categoryId?: number;
    @IsNotEmpty()
    @IsNumber()
    year: number;
    @IsNotEmpty()
    @IsString()
    name: string;
    @IsNotEmpty()
    @IsString()
    description: string;
    @IsNotEmpty()
    @IsNumber()
    order: number;
    @IsOptional()
    @IsNumber()
    nomineeCount?: number;
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => AwardsCategoryTranslationInputDto)
    translations?: AwardsCategoryTranslationInputDto[];
}
