import {
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
    Length,
    Max,
    Min,
    MinLength,
} from "class-validator";
import { Transform } from "class-transformer";

export class CreateReviewDto {
    @IsNumber()
    @IsNotEmpty()
    gameId: number;
    @IsString()
    @MinLength(4)
    @IsOptional()
    @Transform(({ value }) => {
        if (
            typeof value === "string" &&
            (value.trim().length === 0 || value === "<p></p>")
        ) {
            return null;
        }

        return value;
    })
    content?: string;
    @IsNumber()
    @Min(0)
    @Max(5)
    rating: number;
    @IsOptional()
    @IsString({ each: true })
    @Length(36, undefined, {
        each: true,
    })
    mentionedUserIds?: string[] = [];
}
