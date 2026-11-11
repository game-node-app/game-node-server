import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import type {
    ProfileVideoErrorCode,
    ProfileVideoStatus,
} from "../entities/profile-video.entity";
import { Profile } from "../entities/profile.entity";

export class ProfileVideoResponseDto {
    @ApiProperty()
    filename: string;
    @ApiProperty({ example: "mp4" })
    extension: string;
    @ApiProperty({ example: "video/mp4" })
    mimetype: string;
    @ApiProperty()
    size: number;
    @ApiProperty()
    durationMs: number;
    @ApiProperty()
    width: number;
    @ApiProperty()
    height: number;
}

export class ProfileVideoUploadResponseDto {
    @ApiProperty({ enum: ["processing", "ready", "failed"] })
    status: ProfileVideoStatus;
    @ApiProperty({
        nullable: true,
        enum: [
            "conversion_failed",
            "output_too_large",
            "upload_failed",
            "source_missing",
            "timeout",
        ],
    })
    errorCode: ProfileVideoErrorCode | null;
}

export class ProfileVideoUploadsResponseDto {
    @ApiProperty({ type: () => ProfileVideoUploadResponseDto, nullable: true })
    avatar: ProfileVideoUploadResponseDto | null;
    @ApiProperty({ type: () => ProfileVideoUploadResponseDto, nullable: true })
    banner: ProfileVideoUploadResponseDto | null;
}

export class SupporterPreferencesResponseDto {
    @ApiProperty({ example: true, default: true })
    showBadge: boolean;
    @ApiProperty({
        type: String,
        nullable: true,
        example: "founder",
        default: null,
    })
    titleKey: string | null;
    @ApiProperty({ example: true, default: true })
    showAnimatedAvatarBorder: boolean;
    @ApiProperty({ example: true, default: true })
    showSupporterTheme: boolean;
    @ApiProperty({
        type: String,
        nullable: true,
        example: "#FF8800",
        default: null,
    })
    accentColor: string | null;
    @ApiProperty({ example: true, default: true })
    showOnSupportersWall: boolean;
    @ApiProperty({ example: false, default: false })
    showLiveProfile: boolean;
}

export class ProfileResponseDto extends Profile {
    @ApiProperty({
        description: "Whether the profile owner has supporter entitlement.",
        example: false,
    })
    isSupporter: boolean;
    @ApiProperty({
        type: () => SupporterPreferencesResponseDto,
        nullable: true,
        description: "Null while isSupporter is false.",
    })
    supporterPreferences: SupporterPreferencesResponseDto | null;
    @ApiProperty({ type: () => ProfileVideoResponseDto, nullable: true })
    avatarVideo: ProfileVideoResponseDto | null;
    @ApiProperty({ type: () => ProfileVideoResponseDto, nullable: true })
    bannerVideo: ProfileVideoResponseDto | null;
    /** Owner-only; absent from `GET /v1/profile/:id`. */
    @ApiPropertyOptional({ type: () => ProfileVideoUploadsResponseDto })
    videoUploads?: ProfileVideoUploadsResponseDto;
}
