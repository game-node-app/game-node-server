import {
    Controller,
    Get,
    Post,
    Body,
    Patch,
    Param,
    Delete,
    UseInterceptors,
    UploadedFile,
    FileTypeValidator,
    ParseFilePipe,
    UseGuards,
} from "@nestjs/common";
import { ProfileService } from "./profile.service";
import { CreateProfileDto } from "./dto/create-profile.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiConsumes } from "@nestjs/swagger";
import { Session } from "../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { AuthGuard } from "../auth/auth.guard";

@Controller("profile")
@UseGuards(new AuthGuard())
export class ProfileController {
    constructor(private readonly profileService: ProfileService) {}

    // No POST /profile endpoint
    // Profiles are automatically created when a user registers (at the auth.service.ts initUser() method)
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
    async findOwnById(@Session() session: SessionContainer) {
        return await this.profileService.findOneById(session.getUserId(), true);
    }

    /**
     * Used to access other users' profiles
     * @param session
     * @param id
     */
    @Get(":id")
    async findOneById(
        @Session() session: SessionContainer,
        @Param("id") id: string,
    ) {
        return await this.profileService.findOneById(id, false);
    }
}
