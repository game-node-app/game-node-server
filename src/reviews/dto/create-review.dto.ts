import { IsNumber, IsString, Max, Min, MinLength } from "class-validator";

export class CreateReviewDto {
    @IsString()
    @MinLength(3)
    title: string;
    @IsString()
    @MinLength(3)
    content: string;
    @IsNumber()
    @Min(0)
    @Max(5)
    rating: number;
}
