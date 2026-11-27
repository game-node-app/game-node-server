import { EGameCategory, EGameStatus } from "../game-repository.constants";
import { IsArray, IsEnum, IsNumber, IsOptional } from "class-validator";
import { BaseFindDto } from "../../../utils/base-find.dto";
import { Game } from "../entities/game.entity";
import { Type } from "class-transformer";
import { ApiPropertyOptional, OmitType } from "@nestjs/swagger";
import { MaxListSize } from "../../../utils/request-bounds";

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
    @MaxListSize()
    ids?: number[];
    /**
     * Minimum number of external critic reviews (`aggregatedRatingCount`).
     * Unlike the array filters, this is a single comparison.
     */
    @ApiPropertyOptional({ type: Number })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    minCriticReviewCount?: number;
    @ApiPropertyOptional({ enum: EGameStatus, isArray: true })
    @IsOptional()
    @IsArray()
    @IsEnum(EGameStatus, {
        each: true,
    })
    @MaxListSize()
    status?: EGameStatus[];
    @ApiPropertyOptional({ enum: EGameCategory, isArray: true })
    @IsOptional()
    @IsArray()
    @IsEnum(EGameCategory, {
        each: true,
    })
    @MaxListSize()
    category?: EGameCategory[];
    @ApiPropertyOptional({ type: [Number] })
    @IsOptional()
    @IsArray()
    @Type(() => Number)
    @IsNumber(undefined, {
        each: true,
    })
    @MaxListSize()
    themes?: number[];
    @ApiPropertyOptional({ type: [Number] })
    @IsOptional()
    @IsArray()
    @IsNumber(undefined, {
        each: true,
    })
    @Type(() => Number)
    @MaxListSize()
    gameModes?: number[];
    @ApiPropertyOptional({ type: [Number] })
    @IsOptional()
    @IsArray()
    @IsNumber(undefined, {
        each: true,
    })
    @Type(() => Number)
    @MaxListSize()
    platforms?: number[];
    @ApiPropertyOptional({ type: [Number] })
    @IsOptional()
    @IsArray()
    @IsNumber(undefined, {
        each: true,
    })
    @Type(() => Number)
    @MaxListSize()
    genres?: number[];
}
