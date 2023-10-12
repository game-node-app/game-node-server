import { IsArray, IsNotEmpty, Min } from "class-validator";

export class CreateGameDto {
    @IsNotEmpty()
    @IsArray()
    games: any[];
}
