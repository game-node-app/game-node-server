import { Game } from "../entities/game.entity";
import {
    IsNotEmpty,
    IsNumber,
    IsObject,
    IsOptional,
    IsString,
} from "class-validator";
import { FindOptionsRelations } from "typeorm";
import { ToBoolean } from "../../../utils/toBoolean";

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
    @IsOptional()
    @ToBoolean()
    personalizeCovers?: boolean;
    @IsOptional()
    @IsString()
    coverOwnerUserId?: string;
}
