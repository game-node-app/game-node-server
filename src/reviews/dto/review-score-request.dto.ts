import { IsNotEmpty, IsNumber } from "class-validator";

export class ReviewScoreRequestDto {
    @IsNotEmpty()
    @IsNumber()
    gameId: number;
}
