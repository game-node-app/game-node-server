import { ApiPropertyOptional } from "@nestjs/swagger";
import {
    EGameCategory,
    EGameStatus,
} from "../../game/game-repository/game-repository.constants";
import {
    SEARCH_DEFAULT_LIMIT,
    SEARCH_DEFAULT_PAGE,
    SEARCH_MAX_FILTER_ARRAY_LENGTH,
    SEARCH_MAX_FILTER_STRING_LENGTH,
    SEARCH_MAX_LIMIT,
    SEARCH_MAX_OFFSET,
    SEARCH_MAX_QUERY_LENGTH,
} from "../search.constants";
import {
    IsStrictEnumIntArray,
    IsStrictFilterStringArray,
    IsStrictOptionalBoolean,
    IsStrictOptionalQuery,
    IsStrictSearchLimit,
    IsStrictSearchPage,
    PreserveRawValue,
    VALID_GAME_CATEGORY_VALUES,
    VALID_GAME_STATUS_VALUES,
} from "./search-validation";

export class GameSearchRequestDto {
    @ApiPropertyOptional({
        type: String,
        maxLength: SEARCH_MAX_QUERY_LENGTH,
        description:
            "Search query matched against game names and alternative names. When omitted or empty, browses games using the supplied filters.",
    })
    @PreserveRawValue()
    @IsStrictOptionalQuery()
    query?: string;

    @ApiPropertyOptional({
        type: [Number],
        enum: EGameCategory,
        isArray: true,
        maxItems: SEARCH_MAX_FILTER_ARRAY_LENGTH,
        description: "Game category enum values (OR within field).",
    })
    @PreserveRawValue()
    @IsStrictEnumIntArray(VALID_GAME_CATEGORY_VALUES, "EGameCategory")
    category?: number[];

    @ApiPropertyOptional({
        type: [Number],
        enum: EGameStatus,
        isArray: true,
        maxItems: SEARCH_MAX_FILTER_ARRAY_LENGTH,
        description: "Game status enum values (OR within field).",
    })
    @PreserveRawValue()
    @IsStrictEnumIntArray(VALID_GAME_STATUS_VALUES, "EGameStatus")
    status?: number[];

    @ApiPropertyOptional({
        type: [String],
        maxItems: SEARCH_MAX_FILTER_ARRAY_LENGTH,
        description: `Genre resource names or decimal IDs (each max ${SEARCH_MAX_FILTER_STRING_LENGTH} chars, max ${SEARCH_MAX_FILTER_ARRAY_LENGTH} items, OR within field).`,
    })
    @PreserveRawValue()
    @IsStrictFilterStringArray()
    genres?: string[];

    @ApiPropertyOptional({
        type: [String],
        maxItems: SEARCH_MAX_FILTER_ARRAY_LENGTH,
        description: `Theme resource names or decimal IDs (each max ${SEARCH_MAX_FILTER_STRING_LENGTH} chars, max ${SEARCH_MAX_FILTER_ARRAY_LENGTH} items, OR within field).`,
    })
    @PreserveRawValue()
    @IsStrictFilterStringArray()
    themes?: string[];

    @ApiPropertyOptional({
        type: [String],
        maxItems: SEARCH_MAX_FILTER_ARRAY_LENGTH,
        description: `Platform resource names, abbreviations, or decimal IDs (each max ${SEARCH_MAX_FILTER_STRING_LENGTH} chars, max ${SEARCH_MAX_FILTER_ARRAY_LENGTH} items, OR within field).`,
    })
    @PreserveRawValue()
    @IsStrictFilterStringArray()
    platforms?: string[];

    @ApiPropertyOptional({
        type: Number,
        minimum: 1,
        maximum: SEARCH_MAX_LIMIT,
        default: SEARCH_DEFAULT_LIMIT,
        description: `Results per page (1-${SEARCH_MAX_LIMIT}; defaults to ${SEARCH_DEFAULT_LIMIT} when omitted or 0). Effective offset ((page - 1) * limit) must not exceed ${SEARCH_MAX_OFFSET}.`,
    })
    @PreserveRawValue()
    @IsStrictSearchLimit()
    limit?: number;

    @ApiPropertyOptional({
        type: Number,
        minimum: 1,
        default: SEARCH_DEFAULT_PAGE,
        description: `1-based page number (defaults to ${SEARCH_DEFAULT_PAGE} when omitted or 0). Effective offset ((page - 1) * limit) must not exceed ${SEARCH_MAX_OFFSET}.`,
    })
    @PreserveRawValue()
    @IsStrictSearchPage()
    page?: number;

    @ApiPropertyOptional({
        type: Boolean,
        description:
            "Legacy boolean flag accepted for client compatibility; engine execution profiles are never exposed to public responses.",
    })
    @PreserveRawValue()
    @IsStrictOptionalBoolean()
    profile?: boolean;
}

export class GameAutocompleteRequestDto extends GameSearchRequestDto {}
