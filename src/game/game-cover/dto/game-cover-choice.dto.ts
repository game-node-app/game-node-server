import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsNumber } from "class-validator";

export class SetGameCoverChoiceDto {
    @ApiProperty({ description: "Id of a listed cover option" })
    @IsNotEmpty()
    @IsNumber({ allowNaN: false, allowInfinity: false })
    coverOptionId: number;
}

export class GameCoverChoiceResponseDto {
    @ApiProperty({
        nullable: true,
        description: "Null when the user has no choice for the game",
    })
    coverOptionId: number | null;
}
