import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { InjectRepository } from "@nestjs/typeorm";
import { Profile } from "./entities/profile.entity";
import { Repository } from "typeorm";
import { ProfileAvatar } from "./entities/profile-avatar.entity";
import * as fs from "fs/promises";
import { generateUsername } from "unique-username-generator";
import {
    PROFILE_IMAGE_ALLOWED_IDENTIFIERS,
    ProfileImageIdentifier,
    UpdateProfileImageDto,
} from "./dto/update-profile-image.dto";
import { ProfileBanner } from "./entities/profile-banner.entity";
import { FindAllProfileResponseItemDto } from "./dto/find-all-profile.dto";
import { SuspensionService } from "../suspension/suspension.service";
import { getPersistedImagePath } from "../utils/getPersistedImagePath";
import { UploadService } from "../upload/upload.service";

@Injectable()
export class ProfileService {
    private logger = new Logger(ProfileService.name);
    constructor(
        @InjectRepository(Profile)
        private profileRepository: Repository<Profile>,
        @InjectRepository(ProfileAvatar)
        private profileAvatarRepository: Repository<ProfileAvatar>,
        @InjectRepository(ProfileBanner)
        private profileBannerRepository: Repository<ProfileBanner>,
        private readonly suspensionService: SuspensionService,
        private readonly uploadService: UploadService,
    ) {}

    /**
     * Called at initial user registration
     * @param userId
     */
    async create(userId: string) {
        let usernameInUse = true;
        let placeholderUsername = "";
        while (usernameInUse) {
            placeholderUsername = generateUsername("-", 4, 20);
            usernameInUse = await this.existsByUserName(placeholderUsername);
        }

        const profile = this.profileRepository.create({
            userId: userId,
            username: placeholderUsername,
        });
        await this.profileRepository.insert(profile);
    }

    private async persistImage(
        userId: string,
        type: ProfileImageIdentifier,
        file: Express.Multer.File,
    ) {
        let fileName: string;
        let fileExt: string;
        try {
            const imageData = await this.uploadService.save(userId, file);
            fileName = imageData.fileName;
            fileExt = imageData.fileExt;
        } catch (e) {
            this.logger.error(e);
            throw new HttpException("Error saving profile image.", 500);
        }

        let targetRepository: Repository<ProfileAvatar | ProfileBanner>;
        if (type === "avatar") {
            targetRepository = this.profileAvatarRepository;
        } else {
            targetRepository = this.profileBannerRepository;
        }

        const profileImage = targetRepository.create({
            encoding: file.encoding,
            filename: fileName,
            mimetype: file.mimetype,
            extension: fileExt,
            size: file.size,
        });

        return await targetRepository.save(profileImage);
    }

    private async detachImage(
        userId: string,
        type: ProfileImageIdentifier,
        removeFile = true,
    ) {
        let targetEntity: ProfileAvatar | ProfileBanner;
        let targetRepository: Repository<ProfileAvatar | ProfileBanner>;
        if (type === "avatar") {
            const avatar = await this.profileAvatarRepository.findOneBy({
                profile: {
                    userId,
                },
            });
            if (!avatar) return;
            targetEntity = avatar;
            targetRepository = this.profileAvatarRepository;
        } else {
            const banner = await this.profileBannerRepository.findOneBy({
                profile: {
                    userId,
                },
            });
            if (!banner) return;
            targetEntity = banner;
            targetRepository = this.profileBannerRepository;
        }

        await this.profileRepository
            .createQueryBuilder()
            .relation(type === "avatar" ? "avatar" : "banner")
            .of({
                userId: userId,
            })
            .set(null);

        await targetRepository.delete(targetEntity.id);

        if (removeFile) {
            const filePath = getPersistedImagePath(
                targetEntity.filename,
                targetEntity.extension,
            );
            try {
                await fs.access(filePath, fs.constants.F_OK);
                await fs.unlink(filePath);
            } catch (e) {
                console.warn(e);
            }
        }
    }

    public async updateProfileImage(
        userId: string,
        dto: UpdateProfileImageDto,
        file: Express.Multer.File,
    ) {
        const profile = await this.findOneByIdOrFail(userId);

        if (file) {
            if (!PROFILE_IMAGE_ALLOWED_IDENTIFIERS.includes(dto.type)) {
                throw new HttpException(
                    "Invalid image type.",
                    HttpStatus.BAD_REQUEST,
                    {
                        cause: `Allowed values: ${PROFILE_IMAGE_ALLOWED_IDENTIFIERS}`,
                    },
                );
            }
            await this.detachImage(userId, dto.type, true);
            if (dto.type === "avatar") {
                profile.avatar = await this.persistImage(
                    userId,
                    dto.type,
                    file,
                );
            } else {
                profile.banner = await this.persistImage(
                    userId,
                    dto.type,
                    file,
                );
            }
        }

        await this.profileRepository.save(profile);
    }

    async findAll(): Promise<FindAllProfileResponseItemDto[]> {
        const result: FindAllProfileResponseItemDto[] = [];
        const profiles = await this.profileRepository.find();

        for (const profile of profiles) {
            const [isSuspended, isBanned] = await Promise.all([
                this.suspensionService.checkIsSuspended(profile.userId),
                this.suspensionService.checkIsBanned(profile.userId),
            ]);

            result.push({
                profile,
                isSuspended,
                isBanned,
            });
        }

        return result;
    }

    async findOneById(userId: string): Promise<Profile | null> {
        return await this.profileRepository.findOne({
            where: {
                userId,
            },
            relations: {
                avatar: true,
                banner: true,
            },
        });
    }

    async findOneByIdOrFail(userId: string) {
        const profile = await this.findOneById(userId);
        if (!profile) {
            throw new HttpException("Profile not found", HttpStatus.NOT_FOUND);
        }
        return profile;
    }

    private async existsByUserName(username: string) {
        return await this.profileRepository.exists({
            where: {
                username,
            },
        });
    }

    async update(userId: string, updateProfileDto: UpdateProfileDto) {
        const profile = await this.findOneById(userId);
        if (!profile) {
            throw new HttpException(
                "Profile was not found",
                HttpStatus.NOT_FOUND,
            );
        }

        if (updateProfileDto.username) {
            const usernameInUse = await this.existsByUserName(
                updateProfileDto.username,
            );
            if (usernameInUse) {
                throw new HttpException(
                    "A profile with the same username already exists",
                    HttpStatus.BAD_REQUEST,
                );
            }
            if (profile.usernameLastUpdatedAt) {
                const thirtyDaysAgo = new Date();
                thirtyDaysAgo.setDate(-30);
                if (
                    profile.usernameLastUpdatedAt.getTime() >
                    thirtyDaysAgo.getTime()
                ) {
                    throw new HttpException(
                        "Username updated in the last 30 days. Please try again later.",
                        HttpStatus.BAD_REQUEST,
                    );
                }
            }
            profile.username = updateProfileDto.username;
            profile.usernameLastUpdatedAt = new Date();
        }

        await this.profileRepository.save(profile);
    }

    async removeProfileImage(userId: string, imageId: number) {}
}
