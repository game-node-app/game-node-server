import { Game } from "../entities/game.entity";
import { IsObject, IsOptional, IsString } from "class-validator";
import { FindOptionsRelations } from "typeorm";
import { ToBoolean } from "../../../utils/toBoolean";
import { IsBoundedRelations } from "../../../utils/request-bounds";

export class GameRepositoryFindOneDto {
    @IsOptional()
    @IsObject()
    @IsBoundedRelations()
    relations?: FindOptionsRelations<Game>;
    @IsOptional()
    @ToBoolean()
    personalizeCovers?: boolean;
    @IsOptional()
    @IsString()
    coverOwnerUserId?: string;
}
