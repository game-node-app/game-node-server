import { Game } from "../entities/game.entity";
import { IsNotEmpty, IsNumber, IsObject, IsOptional } from "class-validator";
import { FindOptionsRelations } from "typeorm";

export class GameRepositoryFindAllDto {
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
    @IsOptional()
    @IsObject()
    relations?: FindOptionsRelations<Game>;
}
