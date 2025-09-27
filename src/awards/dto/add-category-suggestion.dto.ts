import { IsNotEmpty, IsNumber } from "class-validator";

export class AddCategorySuggestionDto {
    @IsNotEmpty()
    @IsNumber()
    categoryId: number;
    @IsNotEmpty()
    @IsNumber()
    gameId: number;
}
