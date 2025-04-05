import {
    Body,
    Controller,
    FileTypeValidator,
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
import {
    ApiConsumes,
    ApiOkResponse,
    ApiResponse,
    ApiTags,
} from "@nestjs/swagger";
import { Session } from "../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { AuthGuard } from "../auth/auth.guard";
import { Profile } from "./entities/profile.entity";
import { Public } from "../auth/public.decorator";
import { UpdateProfileImageDto } from "./dto/update-profile-image.dto";
import { Roles } from "../auth/roles.decorator";
import { EUserRoles } from "../utils/constants";
import { FindAllProfileResponseItemDto } from "./dto/find-all-profile.dto";

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
                    new MaxFileSizeValidator({
                        maxSize: 5 * 1024 * 1000,
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
    async findOneById(
        @Session() session: SessionContainer,
        @Param("id") profileId: string,
    ) {
        return await this.profileService.findOneByIdOrFail(profileId);
    }
}
