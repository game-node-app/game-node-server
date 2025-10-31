import { Injectable } from "@nestjs/common";
import { Repository } from "typeorm";
import { PreferredPlatform } from "./entity/preferred-platform.entity";
import { PreferredPlatformDto } from "./dto/preferred-platform.dto";

@Injectable()
export class PreferredPlatformService {
    constructor(
        private readonly preferredPlatformRepository: Repository<PreferredPlatform>,
    ) {}

    async findAllByUserId(userId: string): Promise<PreferredPlatformDto[]> {
        return this.preferredPlatformRepository.find({
            where: { libraryUserId: userId },
            relations: {
                platform: true,
            },
            order: { order: "ASC" },
        });
    }

    async findAllActiveByUserId(
        userId: string,
    ): Promise<PreferredPlatformDto[]> {
        return this.preferredPlatformRepository.find({
            where: { libraryUserId: userId, enabled: true },
            relations: {
                platform: true,
            },
            order: { order: "ASC" },
        });
    }
}
