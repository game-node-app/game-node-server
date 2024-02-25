import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { InjectRepository } from "@nestjs/typeorm";
import { Profile } from "./entities/profile.entity";
import { Repository } from "typeorm";
import { ProfileAvatar } from "./entities/profile-avatar.entity";
import * as crypto from "crypto";
import { publicImagesDir } from "../utils/constants";
import * as fs from "fs/promises";
import { generateUsername } from "unique-username-generator";
import mimetype from "mime-types";
import { filterBadWords } from "../utils/filterBadWords";

@Injectable()
export class ProfileService {
    private logger = new Logger(ProfileService.name);
    constructor(
        @InjectRepository(Profile)
        private profileRepository: Repository<Profile>,
        @InjectRepository(ProfileAvatar)
        private profileAvatarRepository: Repository<ProfileAvatar>,
    ) {}

    getAvatarFilePath(filename: string, extension: string) {
        return `${publicImagesDir}/uploads/${filename}.${extension}`;
    }

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
        await this.profileRepository.save(profile);
    }

    async createAvatar(avatarFile: Express.Multer.File) {
        const fileName = crypto.randomBytes(16).toString("hex");
        const fileExt = mimetype.extension(avatarFile.mimetype) || "jpeg";

        const filePath = this.getAvatarFilePath(fileName, fileExt);
        try {
            await fs.writeFile(filePath, avatarFile.buffer);
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
        });

        return await this.profileAvatarRepository.save(profileAvatar);
    }

    async detachAvatar(userId: string, removeFile = true) {
        const avatar = await this.profileAvatarRepository.findOneBy({
            profile: {
                userId,
            },
        });
        if (!avatar) return;
        await this.profileRepository
            .createQueryBuilder()
            .relation("avatar")
            .of({
                userId: userId,
            })
            .set(null);
        await this.profileAvatarRepository.delete(avatar.id);
        if (removeFile) {
            const filePath = this.getAvatarFilePath(
                avatar.filename,
                avatar.extension,
            );
            try {
                await fs.access(filePath, fs.constants.F_OK);
                await fs.unlink(filePath);
            } catch (e) {
                console.warn(e);
            }
        }
    }

    async findAll() {
        return await this.profileRepository.find();
    }

    async findOneById(userId: string): Promise<Profile | null> {
        const profile = await this.profileRepository.findOne({
            where: {
                userId,
            },
            relations: {
                avatar: true,
            },
        });
        return profile;
    }

    async findOneByIdOrFail(userId: string) {
        const profile = await this.findOneById(userId);
        if (!profile) {
            throw new HttpException("Profile not found", HttpStatus.NOT_FOUND);
        }
        return profile;
    }

    private async existsByUserName(username: string) {
        return await this.profileRepository.exist({
            where: {
                username,
            },
        });
    }

    async update(
        userId: string,
        updateProfileDto: UpdateProfileDto,
        avatarFile?: Express.Multer.File,
    ) {
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
            profile.username = updateProfileDto.username;
        }

        if (updateProfileDto.bio) {
            profile.bio = filterBadWords(updateProfileDto.bio);
        }

        if (avatarFile) {
            await this.detachAvatar(userId, true);
            profile.avatar = await this.createAvatar(avatarFile);
        }

        await this.profileRepository.save(profile);
    }
}
