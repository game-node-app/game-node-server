import { EGameCategory, EGameStatus } from "../game-repository.constants";
import { IsArray, IsEnum, IsNumber, IsOptional } from "class-validator";
import { BaseFindDto } from "../../../utils/base-find.dto";
import { Game } from "../entities/game.entity";
import { Transform, Type } from "class-transformer";
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
    // @Type(() => Number)
    @IsArray()
    @IsNumber(
        {
            allowNaN: false,
            allowInfinity: false,
            maxDecimalPlaces: 1,
        },
        {
            each: true,
        },
    )
    ids?: number[];
    @IsOptional()
    @IsEnum(EGameStatus)
    status?: EGameStatus;
    @IsOptional()
    @IsEnum(EGameCategory)
    category?: EGameCategory;
    @IsOptional()
    @IsArray()
    @IsNumber(undefined, {
        each: true,
    })
    @Transform(({ value }) => {
        if (Array.isArray(value)) {
            return value.map((v) => parseInt(v, 10));
        }
        return value;
    })
    themes?: number[];
    @IsOptional()
    @IsArray()
    @IsNumber(undefined, {
        each: true,
    })
    @Transform(({ value }) => {
        if (Array.isArray(value)) {
            return value.map((v) => parseInt(v, 10));
        }
        return value;
    })
    gameModes?: number[];
    @IsOptional()
    @IsArray()
    @IsNumber(undefined, {
        each: true,
    })
    @Transform(({ value }) => {
        if (Array.isArray(value)) {
            return value.map((v) => parseInt(v, 10));
        }
        return value;
    })
    platforms?: number[];
    @IsOptional()
    @IsArray()
    @IsNumber(undefined, {
        each: true,
    })
    @Transform(({ value }) => {
        if (Array.isArray(value)) {
            return value.map((v) => parseInt(v, 10));
        }
        return value;
    })
    genres?: number[];
}
