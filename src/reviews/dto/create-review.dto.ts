import {
    IsNotEmpty,
    IsNumber,
    IsString,
    Length,
    Max,
    Min,
    MinLength,
} from "class-validator";

export class CreateReviewDto {
    @IsNumber()
    @IsNotEmpty()
    gameId: number;
    @IsString()
    @MinLength(20)
    content: string;
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
