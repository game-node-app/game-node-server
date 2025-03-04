import {
    IsArray,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
} from "class-validator";

export class CreatePostDto {
    @IsNotEmpty()
    @IsString()
    content: string;
    @IsNotEmpty()
    @IsNumber()
    gameId: number;
    @IsOptional()
    @IsNotEmpty()
    @IsArray()
    @IsNumber(undefined, {
        each: true,
    })
    associatedImageIds: number[] = [];
}
