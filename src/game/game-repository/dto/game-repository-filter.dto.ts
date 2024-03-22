import { EGameCategory, EGameStatus } from "../game-repository.constants";
import { IsArray, IsEnum, IsNumber, IsOptional } from "class-validator";
import { BaseFindDto } from "../../../utils/base-find.dto";
import { Game } from "../entities/game.entity";
import { Transform } from "class-transformer";

export class GameRepositoryFilterDto extends BaseFindDto<Game> {
    @IsOptional()
    @IsArray()
    @IsNumber(
        {
            allowNaN: false,
            allowInfinity: false,
        },
        {
            each: true,
        },
    )
    id?: number[];
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
