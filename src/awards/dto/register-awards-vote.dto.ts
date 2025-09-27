import { IsNotEmpty, IsNumber } from "class-validator";

export class RegisterAwardsVoteDto {
    @IsNotEmpty()
    @IsNumber()
    categoryId: number;
    @IsNotEmpty()
    @IsNumber()
    gameId: number;
}
