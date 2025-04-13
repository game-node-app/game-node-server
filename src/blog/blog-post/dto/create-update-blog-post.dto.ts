import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsNotEmpty,
    IsOptional,
    IsString,
    Length,
    MinLength,
} from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";

export class CreateUpdateBlogPostDto {
    @IsOptional()
    @IsString()
    @Length(36)
    postId?: string;
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
    isDraft: boolean;
}
