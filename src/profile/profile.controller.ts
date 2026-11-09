import {
    BadRequestException,
    Body,
    Controller,
    Get,
    MaxFileSizeValidator,
    Param,
    ParseFilePipe,
    Patch,
    Put,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from "@nestjs/common";
import { ProfileService } from "./profile.service";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiConsumes, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import sharp from "sharp";
import { Session, SessionContainer } from "../auth/session.decorator";
import { AuthGuard } from "../auth/auth.guard";
import { Public } from "../auth/public.decorator";
import { UpdateProfileImageDto } from "./dto/update-profile-image.dto";
import { Roles } from "../auth/roles.decorator";
import { EUserRoles } from "../utils/constants";
import { FindAllProfileResponseItemDto } from "./dto/find-all-profile.dto";
import { ProfileResponseDto } from "./dto/profile-response.dto";
import { ProfileVideoService } from "./profile-video/profile-video.service";

const PROFILE_IMAGE_MAX_BYTES = 10 * 1024 * 1000;

/** Design 10: reject anything whose decoded content is not JPEG or PNG. */
async function assertProfileImageContent(file: Express.Multer.File) {
    let format: string | undefined;
    try {
        format = (await sharp(file.buffer).metadata()).format;
    } catch {
        format = undefined;
    }
    if (format !== "jpeg" && format !== "png") {
        throw new BadRequestException("Profile images must be PNG or JPEG.");
    }
}

@Controller("profile")
@ApiTags("profile")
@UseGuards(AuthGuard)
export class ProfileController {
    constructor(
        private readonly profileService: ProfileService,
        private readonly profileVideoService: ProfileVideoService,
    ) {}

    @Patch()
    async update(
        @Session() session: SessionContainer,
        @Body() updateProfileDto: UpdateProfileDto,
    ) {
        return await this.profileService.update(
            session.getUserId(),
            updateProfileDto,
        );
    }

    @Put("image")
    @ApiConsumes("multipart/form-data")
    @UseInterceptors(
        FileInterceptor("file", {
            limits: { fileSize: PROFILE_IMAGE_MAX_BYTES },
        }),
    )
    async updateImage(
        @Session() session: SessionContainer,
        @Body() updateImageDto: UpdateProfileImageDto,
        @UploadedFile(
            new ParseFilePipe({
                fileIsRequired: false,
                validators: [
                    new MaxFileSizeValidator({
                        maxSize: PROFILE_IMAGE_MAX_BYTES,
                    }),
                ],
            }),
        )
        file: Express.Multer.File,
    ) {
        if (file) await assertProfileImageContent(file);
        await this.profileService.updateProfileImage(
            session.getUserId(),
            updateImageDto,
            file,
        );
    }

    private async findWithVideos(userId: string, includeUploads: boolean) {
        const profile = await this.profileService.findOneByIdOrFail(userId);
        return {
            ...profile,
            ...(await this.profileVideoService.findForProfileRead(
                userId,
                includeUploads,
            )),
        };
    }

    /**
     * Used to access own profile
     * @param session
     */
    @Get()
    @ApiOkResponse({
        type: ProfileResponseDto,
    })
    async findOwn(@Session() session: SessionContainer) {
        return await this.findWithVideos(session.getUserId(), true);
    }

    @Get("all")
    @Roles([EUserRoles.ADMIN, EUserRoles.MOD])
    @ApiOkResponse({
        type: FindAllProfileResponseItemDto,
        isArray: true,
    })
    async findAll() {
        return await this.profileService.findAll();
    }

    /**
     * Used to access other users' profiles
     * @param session
     * @param profileId
     */
    @Get(":id")
    @Public()
    @ApiOkResponse({
        type: ProfileResponseDto,
    })
    async findOneById(
        @Session() session: SessionContainer,
        @Param("id") profileId: string,
    ) {
        return await this.findWithVideos(profileId, false);
    }
}
