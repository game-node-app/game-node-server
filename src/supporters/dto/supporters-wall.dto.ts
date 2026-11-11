import { ApiProperty } from "@nestjs/swagger";
import { ProfileAvatar } from "../../profile/entities/profile-avatar.entity";
import { PaginationInfo } from "../../utils/pagination/pagination-response.dto";

/** Only public profile data: no billing, status or subscription fields. */
export class SupporterWallItemDto {
    @ApiProperty()
    userId: string;

    @ApiProperty()
    username: string;

    @ApiProperty({ type: () => ProfileAvatar, nullable: true })
    avatar: ProfileAvatar | null;
}

export class PaginatedSupportersResponseDto {
    @ApiProperty({ type: [SupporterWallItemDto] })
    data: SupporterWallItemDto[];

    @ApiProperty()
    pagination: PaginationInfo;
}
