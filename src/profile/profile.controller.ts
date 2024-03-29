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

@Controller("profile")
@ApiTags("profile")
@UseGuards(AuthGuard)
export class ProfileController {
    constructor(private readonly profileService: ProfileService) {}

    // No POST /profile endpoint
    // Profiles are automatically created when a user registers (in the user-init module)
    // If this fails, the findOneById() method has an uninitialized profile handler.

    @Patch()
    @ApiConsumes("multipart/form-data")
    @UseInterceptors(FileInterceptor("avatar"))
    async update(
        @Session() session: SessionContainer,
        @Body() updateProfileDto: UpdateProfileDto,
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
        avatarFile?: Express.Multer.File,
    ) {
        return await this.profileService.update(
            session.getUserId(),
            updateProfileDto,
            avatarFile,
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
