import { IsBoolean, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CreateCollectionDto {
    @IsString()
    @IsNotEmpty()
    name: string;
    @IsString()
    @IsOptional()
    description?: string;
    @IsOptional()
    @IsBoolean()
    isPublic: boolean = true;
    @IsOptional()
    @IsBoolean()
    isFeatured: boolean = false;
}
