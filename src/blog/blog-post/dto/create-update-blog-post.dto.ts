import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsPositive,
    IsString,
    Length,
    Max,
    MinLength,
} from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { ToBoolean } from "../../../utils/toBoolean";

export class CreateUpdateBlogPostReviewInfoDto {
    @IsNumber()
    gameId: number;
    @IsPositive()
    @Max(5)
    rating: number;
}

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
    @ToBoolean()
    isDraft: boolean;
    @IsOptional()
    @Transform(({ value }) => JSON.parse(value))
    reviewInfo?: CreateUpdateBlogPostReviewInfoDto;
}
