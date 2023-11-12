import {
    IsNotEmpty,
    IsNumber,
    IsString,
    Max,
    Min,
    MinLength,
} from "class-validator";

export class CreateReviewDto {
    @IsNumber()
    @IsNotEmpty()
    gameId: number;
    @IsString()
    @MinLength(3)
    content: string;
    @IsNumber()
    @Min(0)
    @Max(5)
    rating: number;
}
