import {
    IsNotEmpty,
    IsOptional,
    IsString,
    MaxLength,
    MinLength,
} from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class CreateBlogPostDto {
    @IsNotEmpty()
    @MinLength(4)
    content: string;
    @IsNotEmpty()
    @MinLength(1)
    title: string;
    @IsNotEmpty()
    @IsString({
        each: true,
    })
    @MinLength(1, {
        each: true,
    })
    @MaxLength(10, {
        each: true,
    })
    tags: string[];
    // For OpenAPI reference
    // Do not mention directly
    @IsOptional()
    @ApiPropertyOptional({
        format: "binary",
    })
    image?: Blob;
}
