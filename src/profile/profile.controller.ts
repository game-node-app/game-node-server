import {
    Controller,
    Get,
    Body,
    Patch,
    Param,
    UseInterceptors,
    UploadedFile,
    FileTypeValidator,
    ParseFilePipe,
    UseGuards,
    Put,
    Delete,
} from "@nestjs/common";
import { ProfileService } from "./profile.service";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiConsumes, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Session } from "../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { AuthGuard } from "../auth/auth.guard";
import { Profile } from "./entities/profile.entity";
import { Public } from "../auth/public.decorator";
import { UpdateProfileImageDto } from "./dto/update-profile-image.dto";

// No POST /profile endpoint
@Controller("profile")
@ApiTags("profile")
@UseGuards(AuthGuard)
export class ProfileController {
    constructor(private readonly profileService: ProfileService) {}

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
    @UseInterceptors(FileInterceptor("file"))
    async updateImage(
        @Session() session: SessionContainer,
        @Body() updateImageDto: UpdateProfileImageDto,
        @UploadedFile(
            new ParseFilePipe({
                fileIsRequired: false,
                validators: [
                    new FileTypeValidator({
                        fileType: "image",
                    }),
                ],
            }),
        )
        file: Express.Multer.File,
    ) {
        await this.profileService.updateProfileImage(
            session.getUserId(),
            updateImageDto,
            file,
        );
    }

    @Delete("image/:type/:id")
    async removeImage(
        @Session() session: SessionContainer,
        @Param("imageType") imageType: string,
        @Param("imageId") imageId: number,
    ) {
        await this.profileService.removeProfileImage(
            session.getUserId(),
            imageId,
        );
    }

    /**
     * Used to access own profile
     * @param session
     */
    @Get()
    @ApiResponse({
        status: 200,
        type: Profile,
    })
    async findOwn(@Session() session: SessionContainer) {
        return await this.profileService.findOneByIdOrFail(session.getUserId());
    }

    /**
     * Used to access other users' profiles
     * @param session
     * @param profileId
     */
    @Get(":id")
    @Public()
    async findOneById(
        @Session() session: SessionContainer,
        @Param("id") profileId: string,
    ) {
        return await this.profileService.findOneByIdOrFail(profileId);
    }
}
