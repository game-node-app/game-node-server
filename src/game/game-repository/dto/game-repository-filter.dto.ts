import { EGameCategory, EGameStatus } from "../game-repository.constants";
import { IsArray, IsEnum, IsNumber, IsOptional } from "class-validator";
import { BaseFindDto } from "../../../utils/base-find.dto";
import { Game } from "../entities/game.entity";
import { Type } from "class-transformer";
import { ApiPropertyOptional, OmitType } from "@nestjs/swagger";

export class GameRepositoryFilterDto extends OmitType(BaseFindDto<Game>, [
    "search",
    "orderBy",
]) {
    /**
     * If this is supplied, filtering will be done only for entities specified here. <br>
     * Useful to filter data received from entities which hold game ids (like games and reviews).
     */
    @ApiPropertyOptional({ type: [Number] })
    @IsOptional()
    @Type(() => Number)
    @IsArray()
    @IsNumber(undefined, {
        each: true,
    })
    ids?: number[];
    @ApiPropertyOptional({ enum: EGameStatus, isArray: true })
    @IsOptional()
    @IsArray()
    @IsEnum(EGameStatus, {
        each: true,
    })
    status?: EGameStatus[];
    @ApiPropertyOptional({ enum: EGameCategory, isArray: true })
    @IsOptional()
    @IsArray()
    @IsEnum(EGameCategory, {
        each: true,
    })
    category?: EGameCategory[];
    @ApiPropertyOptional({ type: [Number] })
    @IsOptional()
    @IsArray()
    @Type(() => Number)
    @IsNumber(undefined, {
        each: true,
    })
    themes?: number[];
    @ApiPropertyOptional({ type: [Number] })
    @IsOptional()
    @IsArray()
    @IsNumber(undefined, {
        each: true,
    })
    @Type(() => Number)
    gameModes?: number[];
    @ApiPropertyOptional({ type: [Number] })
    @IsOptional()
    @IsArray()
    @IsNumber(undefined, {
        each: true,
    })
    @Type(() => Number)
    platforms?: number[];
    @ApiPropertyOptional({ type: [Number] })
    @IsOptional()
    @IsArray()
    @IsNumber(undefined, {
        each: true,
    })
    @Type(() => Number)
    genres?: number[];
}
