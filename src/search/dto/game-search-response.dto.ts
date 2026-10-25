import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { SearchPaginationInfoDto } from "./search-pagination.dto";

export class SearchGameDto {
    @ApiProperty({ type: Number })
    id: number;

    @ApiProperty({ type: String })
    name: string;

    @ApiProperty({ type: String })
    slug: string;

    @ApiPropertyOptional({ type: String })
    summary?: string;

    @ApiPropertyOptional({ type: String })
    storyline?: string;

    @ApiPropertyOptional({ type: String })
    checksum?: string;

    @ApiPropertyOptional({ type: Number })
    aggregatedRating?: number;

    @ApiPropertyOptional({ type: Number })
    aggregatedRatingCount?: number;

    @ApiProperty({ type: Number })
    category: number;

    @ApiProperty({ type: Number })
    status: number;

    @ApiPropertyOptional({ type: String })
    firstReleaseDate?: string;

    @ApiProperty({ type: String })
    createdAt: string;

    @ApiProperty({ type: String })
    updatedAt: string;

    @ApiPropertyOptional({ type: String })
    coverUrl?: string;

    @ApiPropertyOptional({ type: String })
    genresNames?: string;

    @ApiPropertyOptional({ type: String })
    themesNames?: string;

    @ApiPropertyOptional({ type: String })
    platformsNames?: string;

    @ApiPropertyOptional({ type: String })
    platformsAbbreviations?: string;

    @ApiPropertyOptional({ type: String })
    keywordsNames?: string;

    @ApiPropertyOptional({ type: Number })
    numLikes?: number;

    @ApiPropertyOptional({ type: Number })
    numViews?: number;

    @ApiProperty({ type: String, example: "manticore" })
    source: string;
}

export class GameSearchResponseDataDto {
    @ApiPropertyOptional({ type: Number })
    took?: number;

    @ApiProperty({ type: () => [SearchGameDto] })
    items: SearchGameDto[];

    @ApiPropertyOptional({
        type: Object,
        additionalProperties: true,
    })
    profile?: Record<string, unknown>;
}

export class GameSearchResponseDto {
    @ApiProperty({ type: () => GameSearchResponseDataDto })
    data: GameSearchResponseDataDto;

    @ApiProperty({ type: () => SearchPaginationInfoDto })
    pagination: SearchPaginationInfoDto;
}

export class GameAutocompleteResponseDto {
    @ApiProperty({ type: Number })
    total: number;

    @ApiProperty({ type: [String] })
    data: string[];
}
