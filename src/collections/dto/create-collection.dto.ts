import { IsBoolean, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CreateCollectionDto {
    @IsString()
    @IsNotEmpty()
    name: string;
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    description: string;
    @IsOptional()
    @IsBoolean()
    isPublic? = true;
    @IsOptional()
    @IsBoolean()
    isFavoritesCollection? = false;
}
