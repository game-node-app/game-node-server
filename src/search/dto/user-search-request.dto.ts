import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
    SEARCH_DEFAULT_LIMIT,
    SEARCH_DEFAULT_PAGE,
    SEARCH_MAX_LIMIT,
    SEARCH_MAX_OFFSET,
    SEARCH_MAX_QUERY_LENGTH,
} from "../search.constants";
import {
    IsStrictRequiredNonBlankQuery,
    IsStrictSearchLimit,
    IsStrictSearchPage,
    PreserveRawValue,
} from "./search-validation";

export class UserSearchRequestDto {
    @ApiProperty({
        type: String,
        minLength: 1,
        maxLength: SEARCH_MAX_QUERY_LENGTH,
        description: `Nonblank username prefix query (1-${SEARCH_MAX_QUERY_LENGTH} characters).`,
    })
    @PreserveRawValue()
    @IsStrictRequiredNonBlankQuery()
    query: string;

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
}
