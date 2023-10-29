import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { CreateProfileDto } from "./dto/create-profile.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { InjectRepository } from "@nestjs/typeorm";
import { Profile } from "./entities/profile.entity";
import { Repository } from "typeorm";
import { ProfileAvatar } from "./entities/profile-avatar.entity";
import * as crypto from "crypto";
import * as path from "path";
import { publicUploadDir } from "../utils/constants";
import * as fs from "fs";
import { generateUsername } from "unique-username-generator";

@Injectable()
export class ProfileService {
    private logger = new Logger(ProfileService.name);
    constructor(
        @InjectRepository(Profile)
        private profileRepository: Repository<Profile>,
        @InjectRepository(ProfileAvatar)
        private profileAvatarRepository: Repository<ProfileAvatar>,
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
            const possibleProfile =
                await this.findOneByUserName(placeholderUsername);
            if (!possibleProfile) {
                usernameInUse = false;
            }
        }

        const profile = this.profileRepository.create({
            userId: userId,
            username: placeholderUsername,
        });
        await this.profileRepository.save(profile);
    }

    async createAvatar(avatarFile: Express.Multer.File) {
        const fileName = crypto.randomBytes(16).toString("hex");
        const fileExt = path.extname(avatarFile.originalname);

        const filePath = `${publicUploadDir}/${fileName}${fileExt}`;
        try {
            fs.writeFileSync(filePath, avatarFile.buffer);
        } catch (e) {
            this.logger.error(e);
            throw new HttpException("Error saving employee picture.", 500);
        }
        const profileAvatar = this.profileAvatarRepository.create({
            encoding: avatarFile.encoding,
            filename: fileName,
            mimetype: avatarFile.mimetype,
            extension: fileExt,
            size: avatarFile.size,
            path: filePath,
        });

        return await this.profileAvatarRepository.save(profileAvatar);
    }

    async findAll() {
        return await this.profileRepository.find();
    }

    async findOneById(
        userId: string,
        handleUninitialized = false,
    ): Promise<Profile | null> {
        const profile = await this.profileRepository.findOne({
            where: {
                userId,
            },
            relations: {
                avatar: true,
            },
        });
        if (!profile && handleUninitialized) {
            await this.handleUninitializedProfile(userId);
            return await this.findOneById(userId);
        }
        return profile;
    }

    async findOneByIdOrFail(userId: string, handleUnitialized = false) {
        const profile = await this.findOneById(userId, handleUnitialized);
        if (!profile) {
            throw new HttpException("Profile not found", HttpStatus.NOT_FOUND);
        }
        return profile;
    }

    async findOneByUserName(username: string) {
        return await this.profileRepository.findOne({
            where: {
                username,
            },
        });
    }

    async update(
        id: string,
        updateProfileDto: UpdateProfileDto,
        avatarFile?: Express.Multer.File,
    ) {
        const profile = await this.findOneById(id);
        if (!profile) {
            await this.handleUninitializedProfile(id);
            throw new HttpException(
                "Profile was not found",
                HttpStatus.NOT_FOUND,
            );
        }
        if (updateProfileDto.username) {
            const possibleProfile = await this.findOneByUserName(
                updateProfileDto.username,
            );
            if (possibleProfile) {
                throw new HttpException(
                    "A profile with the same username already exists",
                    HttpStatus.BAD_REQUEST,
                );
            }
            profile.username = updateProfileDto.username;
        }
        if (updateProfileDto.avatar && avatarFile) {
            if (profile.avatar) {
                await this.profileAvatarRepository.delete({
                    id: profile.avatar.id,
                });
            }
            profile.avatar = await this.createAvatar(avatarFile);
        }
        await this.profileRepository.save(profile);
    }

    async handleUninitializedProfile(userId: string) {
        await this.create(userId);
    }
}
