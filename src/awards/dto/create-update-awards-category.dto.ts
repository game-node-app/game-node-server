import { IsNotEmpty, IsNumber, IsOptional, IsString } from "class-validator";

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
}
