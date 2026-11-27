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
import { IsBoundedRelations, MaxListSize } from "../../../utils/request-bounds";

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
    @MaxListSize()
    gameIds: number[];
    @IsOptional()
    @IsObject()
    @IsBoundedRelations<GameRepositoryFindAllDto>(
        (dto) => dto.gameIds?.length ?? 0,
    )
    relations?: FindOptionsRelations<Game>;
    @IsOptional()
    @ToBoolean()
    personalizeCovers?: boolean;
    @IsOptional()
    @IsString()
    coverOwnerUserId?: string;
}
