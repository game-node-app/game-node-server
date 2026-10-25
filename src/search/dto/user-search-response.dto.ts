import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { SearchPaginationInfoDto } from "./search-pagination.dto";

export class SearchUserDto {
    @ApiProperty({ type: String })
    userId: string;

    @ApiProperty({ type: String })
    username: string;
}

export class UserSearchResponseDataDto {
    @ApiPropertyOptional({ type: Number })
    took?: number;

    @ApiProperty({ type: () => [SearchUserDto] })
    items: SearchUserDto[];

    @ApiPropertyOptional({
        type: Object,
        additionalProperties: true,
    })
    profile?: Record<string, unknown>;
}

export class UserSearchResponseDto {
    @ApiProperty({ type: () => UserSearchResponseDataDto })
    data: UserSearchResponseDataDto;

    @ApiProperty({ type: () => SearchPaginationInfoDto })
    pagination: SearchPaginationInfoDto;
}
