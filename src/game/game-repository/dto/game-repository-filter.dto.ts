import { EGameCategory, EGameStatus } from "../game-repository.constants";
import { IsArray, IsEnum, IsNumber, IsOptional } from "class-validator";
import { BaseFindDto } from "../../../utils/base-find.dto";
import { Game } from "../entities/game.entity";
import { Type } from "class-transformer";
import { OmitType } from "@nestjs/swagger";

export class GameRepositoryFilterDto extends OmitType(BaseFindDto<Game>, [
    "search",
    "orderBy",
]) {
    /**
     * If this is supplied, filtering will be done only for entities specified here. <br>
     * Useful to filter data received from entities which hold game ids (like GameStatistics, Reviews, etc.)
     */
    @IsOptional()
    @Type(() => Number)
    @IsArray()
    @IsNumber(undefined, {
        each: true,
    })
    ids?: number[];
    @IsOptional()
    @IsArray()
    @IsEnum(EGameStatus, {
        each: true,
    })
    status?: EGameStatus[];
    @IsOptional()
    @IsArray()
    @IsEnum(EGameCategory, {
        each: true,
    })
    category?: EGameCategory[];
    @IsOptional()
    @IsArray()
    @Type(() => Number)
    @IsNumber(undefined, {
        each: true,
    })
    themes?: number[];
    @IsOptional()
    @IsArray()
    @IsNumber(undefined, {
        each: true,
    })
    @Type(() => Number)
    gameModes?: number[];
    @IsOptional()
    @IsArray()
    @IsNumber(undefined, {
        each: true,
    })
    @Type(() => Number)
    platforms?: number[];
    @IsOptional()
    @IsArray()
    @IsNumber(undefined, {
        each: true,
    })
    @Type(() => Number)
    genres?: number[];
}
