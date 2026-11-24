import {
    BadRequestException,
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    MaxFileSizeValidator,
    Param,
    ParseFilePipe,
    Patch,
    Post,
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
import { FindProfilesByIdsDto } from "./dto/find-profiles-by-ids.dto";
import { ProfileResponseDto } from "./dto/profile-response.dto";
import { ProfileVideoService } from "./profile-video/profile-video.service";
import { SupporterPreferencesService } from "./supporter-preferences/supporter-preferences.service";
import { LibraryAccessService } from "../libraries/library-access.service";
import { BillingService } from "../billing/billing.service";

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
        private readonly supporterPreferencesService: SupporterPreferencesService,
        private readonly libraryAccessService: LibraryAccessService,
        private readonly billingService: BillingService,
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

    private async findWithVideos(
        userId: string,
        includeUploads: boolean,
        viewerId: string | undefined,
    ) {
        // Design 1: entitlement runs once, alongside the profile read.
        const [profile, isSupporter] = await Promise.all([
            this.profileService.findOneByIdOrFail(userId),
            this.profileVideoService.isSupporter(userId),
        ]);
        const access =
            viewerId === userId
                ? {
                      libraryVisibility: profile.libraryVisibility,
                      canViewLibrary: true,
                  }
                : await this.libraryAccessService.resolve(viewerId, userId);
        const [videos, supporterPreferences] = await Promise.all([
            this.profileVideoService.findForProfileRead(
                userId,
                includeUploads,
                isSupporter,
            ),
            isSupporter
                ? this.supporterPreferencesService.findOrDefaults(userId)
                : null,
        ]);
        return {
            ...profile,
            libraryVisibility: access.libraryVisibility,
            ...videos,
            isSupporter,
            supporterPreferences,
            canViewLibrary: access.canViewLibrary,
        };
    }

    /**
     * Batch counterpart of `GET /v1/profile/:id`: one profile query, one entitlement query and
     * one library-access resolution, with videos and preferences read only for supporters.
     */
    private async findManyWithVideos(
        userIds: string[],
        viewerId: string | undefined,
    ) {
        const [profiles, supporterIds] = await Promise.all([
            this.profileService.findManyByIds(userIds),
            this.billingService.findSupporterUserIdsIn(userIds),
        ]);
        const supporterIdList = profiles
            .filter((profile) => supporterIds.has(profile.userId))
            .map((profile) => profile.userId);
        const [access, videos, preferences] = await Promise.all([
            this.libraryAccessService.resolveMany(viewerId, profiles),
            this.profileVideoService.findForProfileReadMany(supporterIdList),
            this.supporterPreferencesService.findOrDefaultsMany(
                supporterIdList,
            ),
        ]);
        const profilesById = new Map(
            profiles.map((profile) => [profile.userId, profile]),
        );

        return userIds.flatMap((userId) => {
            const profile = profilesById.get(userId);
            const profileAccess = access.get(userId);
            if (!profile || !profileAccess) return [];
            const isSupporter = supporterIds.has(userId);

            return [
                {
                    ...profile,
                    libraryVisibility: profileAccess.libraryVisibility,
                    ...(videos.get(userId) ?? {
                        avatarVideo: null,
                        bannerVideo: null,
                    }),
                    isSupporter,
                    supporterPreferences: isSupporter
                        ? (preferences.get(userId) ?? null)
                        : null,
                    canViewLibrary: profileAccess.canViewLibrary,
                },
            ];
        });
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
        const userId = session.getUserId();
        return await this.findWithVideos(userId, true, userId);
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

    @Post("all")
    @Public()
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({
        type: ProfileResponseDto,
        isArray: true,
    })
    async findManyByIds(
        @Session() session: SessionContainer,
        @Body() dto: FindProfilesByIdsDto,
    ) {
        return await this.findManyWithVideos(
            [...new Set(dto.userIds)],
            session?.getUserId(),
        );
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
        return await this.findWithVideos(
            profileId,
            false,
            session?.getUserId(),
        );
    }
}
