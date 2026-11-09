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

export class ProfileResponseDto extends Profile {
    @ApiProperty({ type: () => ProfileVideoResponseDto, nullable: true })
    avatarVideo: ProfileVideoResponseDto | null;
    @ApiProperty({ type: () => ProfileVideoResponseDto, nullable: true })
    bannerVideo: ProfileVideoResponseDto | null;
    /** Owner-only; absent from `GET /v1/profile/:id`. */
    @ApiPropertyOptional({ type: () => ProfileVideoUploadsResponseDto })
    videoUploads?: ProfileVideoUploadsResponseDto;
}
