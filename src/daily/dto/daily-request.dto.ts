import {
    ArrayMaxSize,
    IsArray,
    IsEnum,
    IsIn,
    IsInt,
    IsOptional,
    Max,
    Min,
    ValidateBy,
    ValidateNested,
} from "class-validator";
import { MAX_OFFSET } from "../../utils/request-bounds";
import { Type } from "class-transformer";
import { ApiProperty, PickType } from "@nestjs/swagger";
import { BaseFindDto } from "../../utils/base-find.dto";
import { DailyMode, DailyPuzzleKind } from "../daily.constants";
import { DailyPuzzle } from "../entity/daily-puzzle.entity";
import { DailyRankingPeriod, DailyRankingScope } from "../daily-ranking.utils";

// class-validator's `each` checks can't allow null entries, so the skip-aware list gets its own rule.
const IsGuessList = () =>
    ValidateBy({
        name: "isGuessList",
        validator: {
            validate: (value: unknown) =>
                Array.isArray(value) &&
                value.length <= 10 &&
                value.every(
                    (id) => id === null || (Number.isSafeInteger(id) && id > 0),
                ),
            defaultMessage: () =>
                "guesses must be at most 10 game ids, or null for a skip",
        },
    });

export class DailyArchiveRequestDto extends PickType(BaseFindDto<DailyPuzzle>, [
    "offset",
    "limit",
]) {
    @IsOptional()
    @IsEnum(DailyMode)
    mode?: DailyMode;
}

export class DailyResultsRequestDto {
    @IsOptional()
    @IsEnum(DailyMode)
    mode?: DailyMode;
    @IsOptional()
    @IsIn(["daily", "weekly"])
    kind?: DailyPuzzleKind;
}

export class DailyPlayRequestDto {
    /** Guessed game ids in order, `null` for a skip. */
    @ApiProperty({
        type: "array",
        items: { type: "integer", nullable: true },
        maxItems: 10,
    })
    @IsGuessList()
    guesses: (number | null)[];
    /**
     * Specs mode only: how many guesses existed when the hint (one revealed column, costing an attempt) was used.
     */
    @IsOptional()
    @IsInt()
    @Min(5)
    hintAt?: number | null;
}

export class DailyPracticeStartRequestDto {
    /** Practice exists for the two competition modes only. */
    @IsIn([DailyMode.COVER, DailyMode.SPECS])
    mode: DailyMode;
}

export class DailyImportResultItemDto extends DailyPlayRequestDto {
    @IsInt()
    @Min(1)
    puzzleId: number;
}

export class DailyImportResultsRequestDto {
    @IsArray()
    @ArrayMaxSize(200)
    @ValidateNested({ each: true })
    @Type(() => DailyImportResultItemDto)
    results: DailyImportResultItemDto[];
}

export class DailyRankingRequestDto {
    @IsOptional()
    @IsIn(["today", "week", "month", "all"])
    period?: DailyRankingPeriod = "week";
    @IsOptional()
    @IsEnum(DailyMode)
    mode?: DailyMode;
    @IsOptional()
    @IsIn(["all", "following"])
    scope?: DailyRankingScope = "all";
    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(MAX_OFFSET)
    offset?: number = 0;
    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number = 20;
}
