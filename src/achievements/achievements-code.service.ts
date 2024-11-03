import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import * as crypto from "node:crypto";
import { achievementsData } from "./data/achievements.data";
import {
    CreateAchievementCodeRequestDto,
    CreateAchievementCodeResponseDto,
} from "./dto/create-achievement-code.dto";
import { InjectRepository } from "@nestjs/typeorm";
import { AchievementCode } from "./entities/achievement-code.entity";
import { Repository } from "typeorm";
import { AchievementsService } from "./achievements.service";
/**
 * Service responsible for handling achievement code consumption and creation.
 */
@Injectable()
export class AchievementsCodeService {
    constructor(
        @InjectRepository(AchievementCode)
        private achievementCodeRepository: Repository<AchievementCode>,
        private achievementsService: AchievementsService,
    ) {}

    private generateCode() {
        return crypto.randomBytes(4).toString("hex").toUpperCase();
    }

    async findOneById(id: string) {
        return this.achievementCodeRepository.findOneBy({
            id,
        });
    }

    /**
     * Creates and registers a new achievement code ready to be consumed.
     * Returns the generated code.
     * @param issuerUserId
     * @param dto
     */
    async create(
        issuerUserId: string,
        dto: CreateAchievementCodeRequestDto,
    ): Promise<CreateAchievementCodeResponseDto> {
        const { achievementId, expiresAt, isSingleUse } = dto;
        const achievementExists =
            this.achievementsService.getAchievementById(achievementId);

        if (!achievementExists) {
            throw new HttpException(
                "achievementId doesn't exist. Please check request parameters.",
                HttpStatus.BAD_REQUEST,
            );
        } else if (Date.now() > expiresAt.getTime()) {
            throw new HttpException(
                "expiresAt must be in the future.",
                HttpStatus.BAD_REQUEST,
            );
        }

        const code = this.achievementCodeRepository.create({
            id: this.generateCode(),
            achievementId: achievementId,
            isForceExpired: false,
            expiresAt: expiresAt,
            isSingleUse: isSingleUse ?? true,
            issuedByUserId: issuerUserId,
        });

        const insertedEntry = await this.achievementCodeRepository.save(code);

        return {
            code: insertedEntry.id,
            expiresAt: expiresAt,
        };
    }

    async consume(userId: string, code: string) {
        const possibleCode = await this.findOneById(code);
        if (!possibleCode) {
            throw new HttpException("Code not found", HttpStatus.NOT_FOUND);
        }

        const achievementId = possibleCode.achievementId;

        const isValid =
            possibleCode.expiresAt.getTime() > Date.now() &&
            !possibleCode.isForceExpired;

        if (!isValid) {
            throw new HttpException(
                "Code has expired.",
                HttpStatus.BAD_REQUEST,
            );
        }

        await this.achievementsService.grantAchievement(userId, achievementId);

        if (possibleCode.isSingleUse) {
            await this.achievementCodeRepository.update(possibleCode.id, {
                consumedByUserId: userId,
                isForceExpired: true,
            });
        }
    }
}
