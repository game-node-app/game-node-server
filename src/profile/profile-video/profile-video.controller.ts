import {
    BadRequestException,
    Body,
    Controller,
    HttpCode,
    HttpStatus,
    Put,
    Session,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { seconds, Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { ApiBody, ApiConsumes, ApiResponse, ApiTags } from "@nestjs/swagger";
import { rm } from "node:fs/promises";
import { AuthGuard } from "../../auth/auth.guard";
import { SessionContainer } from "../../auth/session.decorator";
import { SupporterGuard } from "../../billing/supporter.guard";
import { UploadProfileVideoResponseDto } from "../dto/upload-profile-video.dto";
import { ProfileImageIdentifier } from "../dto/update-profile-image.dto";
import {
    PROFILE_VIDEO_MAX_UPLOAD_BYTES,
    PROFILE_VIDEO_TEMP_ROOT,
    ProfileVideoUpload,
} from "./profile-video.constants";
import { ProfileVideoService } from "./profile-video.service";

const CROP_FIELDS = ["cropX", "cropY", "cropWidth", "cropHeight"] as const;

export function parseProfileVideoUpload(
    body: Record<string, unknown>,
): ProfileVideoUpload {
    const type = body.type;
    if (type !== "avatar" && type !== "banner") {
        throw new BadRequestException("Invalid video type.");
    }

    const present = CROP_FIELDS.filter((field) => body[field] !== undefined);
    if (present.length === 0) {
        return { type: type as ProfileImageIdentifier };
    }
    if (present.length !== CROP_FIELDS.length) {
        throw new BadRequestException("All crop fields must be sent together.");
    }

    const [x, y, width, height] = CROP_FIELDS.map((field) =>
        Number(body[field]),
    );
    const valid =
        [x, y, width, height].every(
            (value) => Number.isFinite(value) && value >= 0 && value <= 1,
        ) &&
        width > 0 &&
        height > 0 &&
        x + width <= 1 &&
        y + height <= 1;
    if (!valid) {
        throw new BadRequestException("Invalid crop.");
    }

    return {
        type: type as ProfileImageIdentifier,
        crop: { x, y, width, height },
    };
}

@Controller("profile")
@ApiTags("profile")
@UseGuards(AuthGuard)
export class ProfileVideoController {
    constructor(private readonly profileVideoService: ProfileVideoService) {}

    /**
     * The body is parsed here instead of a pipe so every rejection after Multer
     * can remove the temporary source in the same catch.
     */
    @Put("video")
    @HttpCode(HttpStatus.ACCEPTED)
    @ApiConsumes("multipart/form-data")
    @ApiBody({
        schema: {
            type: "object",
            required: ["file", "type"],
            properties: {
                file: { type: "string", format: "binary" },
                type: { type: "string", enum: ["avatar", "banner"] },
                cropX: { type: "number" },
                cropY: { type: "number" },
                cropWidth: { type: "number" },
                cropHeight: { type: "number" },
            },
        },
    })
    @ApiResponse({ status: 202, type: UploadProfileVideoResponseDto })
    @UseGuards(ThrottlerGuard, SupporterGuard)
    @Throttle({ default: { limit: 5, ttl: seconds(60) } })
    @UseInterceptors(
        FileInterceptor("file", {
            dest: PROFILE_VIDEO_TEMP_ROOT,
            limits: {
                fileSize: PROFILE_VIDEO_MAX_UPLOAD_BYTES,
                files: 1,
            },
        }),
    )
    async upload(
        @Session() session: SessionContainer,
        @Body() body: Record<string, unknown>,
        @UploadedFile() file?: Express.Multer.File,
    ) {
        if (!file) {
            throw new BadRequestException("A video file is required.");
        }

        try {
            return await this.profileVideoService.upload(
                session.getUserId(),
                parseProfileVideoUpload(body),
                file,
            );
        } catch (error) {
            await rm(file.path, { force: true }).catch(() => undefined);
            throw error;
        }
    }
}
