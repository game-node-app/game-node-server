import { HttpException, Injectable } from "@nestjs/common";
import { FindOptionsRelations, Repository } from "typeorm";
import { PreferredPlatform } from "./entity/preferred-platform.entity";
import { PreferredPlatformDto } from "./dto/preferred-platform.dto";
import { InjectRepository } from "@nestjs/typeorm";
import { CreatePreferredPlatformDto } from "./dto/create-preferred-platform.dto";
import { getIconNameForPlatformAbbreviation } from "../game/game-repository/game-repository.utils";
import { Cacheable } from "../utils/cacheable";
import { minutes } from "@nestjs/throttler";

const toDto = (entity: PreferredPlatform): PreferredPlatformDto => {
    return {
        ...entity,
        iconName: getIconNameForPlatformAbbreviation(
            entity.platform.abbreviation,
        ),
    };
};

@Injectable()
export class PreferredPlatformService {
    private readonly RELATIONS: FindOptionsRelations<PreferredPlatform> = {
        platform: true,
    };

    constructor(
        @InjectRepository(PreferredPlatform)
        private readonly preferredPlatformRepository: Repository<PreferredPlatform>,
    ) {}

    async findOneByUserIdAndPlatformId(
        userId: string,
        platformId: number,
    ): Promise<PreferredPlatformDto | null> {
        const item = await this.preferredPlatformRepository.findOne({
            where: { libraryUserId: userId, platformId },
            relations: this.RELATIONS,
        });

        return item ? toDto(item) : null;
    }

    async findOneByUserIdAndPlatformIdOrFail(
        userId: string,
        platformId: number,
    ): Promise<PreferredPlatformDto> {
        const item = await this.findOneByUserIdAndPlatformId(
            userId,
            platformId,
        );

        if (!item) {
            throw new HttpException("Preferred platform not found", 404);
        }

        return item;
    }

    async findAllByUserId(userId: string): Promise<PreferredPlatformDto[]> {
        const items = await this.preferredPlatformRepository.find({
            where: { libraryUserId: userId },
            relations: this.RELATIONS,
        });

        return items.map(toDto);
    }

    @Cacheable(PreferredPlatformService.name, minutes(1))
    async findAllActiveByUserId(
        userId: string,
    ): Promise<PreferredPlatformDto[]> {
        const items = await this.preferredPlatformRepository.find({
            where: { libraryUserId: userId, enabled: true },
            relations: this.RELATIONS,
        });

        return items.map(toDto);
    }

    async findAllByPlatformAbbreviations(
        userId: string,
        platformAbbreviations: string[],
    ): Promise<PreferredPlatformDto[]> {
        const items = await this.findAllActiveByUserId(userId);

        return items.filter((item) =>
            platformAbbreviations.includes(item.platform.abbreviation),
        );
    }

    async createOrUpdate(userId: string, dto: CreatePreferredPlatformDto) {
        const existing = await this.findOneByUserIdAndPlatformId(
            userId,
            dto.platformId,
        );

        await this.preferredPlatformRepository.save({
            ...existing,
            libraryUserId: userId,
            platformId: dto.platformId,
            enabled: dto.isEnabled ?? true,
            label: dto.label,
        });
    }

    async delete(userId: string, platformId: number) {
        const existing = await this.findOneByUserIdAndPlatformIdOrFail(
            userId,
            platformId,
        );

        await this.preferredPlatformRepository.softDelete({
            id: existing.id,
        });
    }
}
