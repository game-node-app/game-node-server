import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsNotEmpty,
    IsOptional,
    IsString,
    MinLength,
} from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";

export class CreateBlogPostDto {
    @IsNotEmpty()
    @MinLength(4)
    content: string;
    @IsNotEmpty()
    @MinLength(1)
    title: string;
    @IsNotEmpty()
    @Transform(({ value }) => {
        if (typeof value === "string") {
            return [value];
        }

        return value;
    })
    @IsArray()
    @IsString({
        each: true,
    })
    @ArrayMinSize(1)
    @ArrayMaxSize(10)
    tags: string[];
    // For OpenAPI reference
    // Do not mention directly
    @IsOptional()
    @ApiPropertyOptional({
        format: "binary",
    })
    image?: Blob;
    @IsNotEmpty()
    @IsBoolean()
    isDraft: boolean;
}
