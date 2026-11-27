import { IsNotEmpty, IsNumber } from "class-validator";
import { GameTimeToBeatDto } from "./find-game-playtime.dto";
import { Type } from "class-transformer";
import { MaxListSize } from "../../utils/request-bounds";

export class FindAllGameTimeToBeatRequestDto {
    @IsNotEmpty()
    @Type(() => Number)
    @IsNumber({}, { each: true })
    @MaxListSize()
    gameIds: number[];
}

export class FindAllGameTimeToBeatResponseDto {
    /**
     * Matches found for gameIds. Not all gameIds will have available playtimes.
     */
    playtimes: GameTimeToBeatDto[];
}
