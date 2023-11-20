import { BaseFindDto } from "../../../utils/base-find.dto";
import { Game } from "../entities/game.entity";
import { IsNotEmpty, IsNumber } from "class-validator";

export class GameRepositoryFindAllDto extends BaseFindDto<Game> {
    @IsNotEmpty()
    @IsNumber(
        {
            allowNaN: false,
            allowInfinity: false,
        },
        {
            each: true,
        },
    )
    gameIds: number[];
}
