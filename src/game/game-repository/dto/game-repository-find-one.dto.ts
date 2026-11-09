import { Game } from "../entities/game.entity";
import { IsObject, IsOptional, IsString } from "class-validator";
import { FindOptionsRelations } from "typeorm";
import { ToBoolean } from "../../../utils/toBoolean";

export class GameRepositoryFindOneDto {
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
