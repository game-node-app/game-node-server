import { EGameCategory, EGameStatus } from "../game-repository.constants";
import { IsArray, IsEnum, IsNumber, IsOptional } from "class-validator";
import { BaseFindDto } from "../../../utils/base-find.dto";
import { Game } from "../entities/game.entity";

export class GameRepositoryFilterDto extends BaseFindDto<Game> {
    @IsOptional()
    @IsEnum(EGameStatus)
    status?: EGameStatus;
    @IsOptional()
    @IsEnum(EGameCategory)
    category?: EGameCategory;
    @IsOptional()
    @IsNumber(undefined, {
        each: true,
    })
    themes?: number[];
    @IsOptional()
    @IsNumber(undefined, {
        each: true,
    })
    gameModes?: number[];
    @IsOptional()
    @IsNumber(undefined, {
        each: true,
    })
    platforms?: number[];
    @IsOptional()
    @IsNumber(undefined, {
        each: true,
    })
    genres?: number[];
}
