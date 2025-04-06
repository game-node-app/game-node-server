import { IsNotEmpty, IsNumber, IsString } from "class-validator";

export class CreatePostDto {
    @IsNotEmpty()
    @IsString()
    content: string;
    @IsNotEmpty()
    @IsNumber()
    gameId: number;
}
