import { BaseFindDto } from "../../../utils/base-find.dto";
import { Game } from "../entities/game.entity";
import { IsObject, IsOptional } from "class-validator";
import { FindOptionsRelations } from "typeorm";

export class GameRepositoryFindOneDto {
    @IsOptional()
    @IsObject()
    relations?: FindOptionsRelations<Game>;
}
