import {
    Body,
    Controller,
    HttpCode,
    HttpStatus,
    Post,
    VERSION_NEUTRAL,
} from "@nestjs/common";
import {
    ApiBadRequestResponse,
    ApiOkResponse,
    ApiOperation,
    ApiTags,
} from "@nestjs/swagger";
import { SearchService } from "./search.service";
import {
    GameAutocompleteRequestDto,
    GameSearchRequestDto,
} from "./dto/game-search-request.dto";
import {
    GameAutocompleteResponseDto,
    GameSearchResponseDto,
} from "./dto/game-search-response.dto";
import { UserSearchRequestDto } from "./dto/user-search-request.dto";
import { UserSearchResponseDto } from "./dto/user-search-response.dto";
import { StrictSearchBodyPipe } from "./dto/search-validation";
import {
    SEARCH_AUTOCOMPLETE_LIMIT,
    SEARCH_AUTOCOMPLETE_PAGE,
    SEARCH_DEFAULT_LIMIT,
    SEARCH_DEFAULT_PAGE,
    SEARCH_MAX_FILTER_ARRAY_LENGTH,
    SEARCH_MAX_FILTER_STRING_LENGTH,
    SEARCH_MAX_LIMIT,
    SEARCH_MAX_OFFSET,
    SEARCH_MAX_QUERY_LENGTH,
} from "./search.constants";

@Controller({
    path: "search",
    version: ["1", VERSION_NEUTRAL],
})
@ApiTags("search")
export class SearchController {
    constructor(private readonly searchService: SearchService) {}

    @Post("games")
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: "Searches for games using Manticore engine",
        description:
            `Returns a parsed search response from the Manticore engine. ` +
            `Bounds: query <= ${SEARCH_MAX_QUERY_LENGTH} chars; filter arrays <= ${SEARCH_MAX_FILTER_ARRAY_LENGTH} entries; ` +
            `filter strings <= ${SEARCH_MAX_FILTER_STRING_LENGTH} chars; limit 1-${SEARCH_MAX_LIMIT} (default ${SEARCH_DEFAULT_LIMIT} when omitted/0); ` +
            `page >= 1 (default ${SEARCH_DEFAULT_PAGE} when omitted/0); effective offset ((page - 1) * limit) <= ${SEARCH_MAX_OFFSET}.`,
    })
    @ApiOkResponse({
        type: GameSearchResponseDto,
    })
    @ApiBadRequestResponse({
        description:
            "Malformed JSON body, invalid field type, out-of-range enum, string/array length overflow, or pagination/offset out of bounds.",
    })
    async searchGames(
        @Body(new StrictSearchBodyPipe()) dto: GameSearchRequestDto,
    ): Promise<GameSearchResponseDto> {
        return this.searchService.searchGames(dto);
    }

    @Post("games/autocomplete")
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: "Autocomplete games names using Manticore engine",
        description:
            `Returns up to ${SEARCH_AUTOCOMPLETE_LIMIT} matching game names from page ${SEARCH_AUTOCOMPLETE_PAGE}. ` +
            `Validates request fields with the same bounds as game search (query <= ${SEARCH_MAX_QUERY_LENGTH} chars, filters <= ${SEARCH_MAX_FILTER_ARRAY_LENGTH} entries, ` +
            `limit <= ${SEARCH_MAX_LIMIT}, offset <= ${SEARCH_MAX_OFFSET}) and short-circuits empty/omitted queries without an engine request.`,
    })
    @ApiOkResponse({
        type: GameAutocompleteResponseDto,
    })
    @ApiBadRequestResponse({
        description:
            "Malformed JSON body, invalid field type, out-of-range enum, string/array length overflow, or pagination/offset out of bounds.",
    })
    async autocompleteGames(
        @Body(new StrictSearchBodyPipe()) dto: GameAutocompleteRequestDto,
    ): Promise<GameAutocompleteResponseDto> {
        return this.searchService.autocompleteGames(dto);
    }

    @Post("users")
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: "Searches for users using Manticore engine",
        description:
            `Returns public usernames and userIds matching a nonblank username prefix. ` +
            `Bounds: nonblank query <= ${SEARCH_MAX_QUERY_LENGTH} chars; limit 1-${SEARCH_MAX_LIMIT} (default ${SEARCH_DEFAULT_LIMIT} when omitted/0); ` +
            `page >= 1 (default ${SEARCH_DEFAULT_PAGE} when omitted/0); effective offset ((page - 1) * limit) <= ${SEARCH_MAX_OFFSET}.`,
    })
    @ApiOkResponse({
        type: UserSearchResponseDto,
    })
    @ApiBadRequestResponse({
        description:
            "Malformed JSON body, blank or oversized query, invalid field type, or pagination/offset out of bounds.",
    })
    async searchUsers(
        @Body(new StrictSearchBodyPipe()) dto: UserSearchRequestDto,
    ): Promise<UserSearchResponseDto> {
        return this.searchService.searchUsers(dto);
    }
}
