import { PaginationResponseDto } from "../../../utils/pagination/pagination-response.dto";
import { GameExternalGame } from "../entity/game-external-game.entity";
import { ApiPropertyOptional, PickType } from "@nestjs/swagger";
import { BaseFindDto } from "../../../utils/base-find.dto";
import { EGameExternalGameCategory } from "../../game-repository/game-repository.constants";
import { Transform } from "class-transformer";
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsEnum,
    IsNotEmpty,
    IsString,
    MaxLength,
    ValidateIf,
} from "class-validator";

// Supplying either lookup field validates both, so a half-specified lookup is a 400, never a catalog listing.
const lookupRequested = (dto: FindExternalGamesRequestDto) =>
    dto.category !== undefined || dto.uids !== undefined;

export class FindExternalGamesRequestDto extends PickType(
    BaseFindDto<GameExternalGame>,
    ["limit", "offset"],
) {
    @ApiPropertyOptional({
        enum: EGameExternalGameCategory,
        description: "Lookup: required together with uids.",
    })
    @ValidateIf(lookupRequested)
    @IsEnum(EGameExternalGameCategory)
    category?: EGameExternalGameCategory;

    @ApiPropertyOptional({
        type: [String],
        minItems: 1,
        maxItems: 100,
        maxLength: 256,
        description:
            "Lookup: store IDs (1-100, repeated query key), required together with category.",
    })
    @ValidateIf(lookupRequested)
    @Transform(({ value }) =>
        value === undefined || Array.isArray(value) ? value : [value],
    )
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(100)
    @IsString({ each: true })
    @IsNotEmpty({ each: true })
    @MaxLength(256, { each: true })
    uids?: string[];
}

export class FindExternalGamesResponseDto extends PaginationResponseDto {
    declare data: GameExternalGame[];
}
