import { HttpException, Injectable } from "@nestjs/common";
import { FindOptionsRelations, Repository } from "typeorm";
import { PreferredPlatform } from "./entity/preferred-platform.entity";
import { PreferredPlatformDto } from "./dto/preferred-platform.dto";
import { InjectRepository } from "@nestjs/typeorm";
import { CreatePreferredPlatformDto } from "./dto/create-preferred-platform.dto";
import { PreferredPlatformReorderService } from "./preferred-platform-reorder.service";
import { DEFAULT_ORDERING_GAP } from "../utils/ordering";
import { PlatformToIconMap } from "../game/game-repository/game-repository.constants";
import { getIconNameForPlatformAbbreviation } from "../game/game-repository/game-repository.utils";

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
        private readonly preferredPlatformReorderService: PreferredPlatformReorderService,
    ) {}

    async findOneByUserIdAndPlatformId(
        userId: string,
        platformId: number,
    ): Promise<PreferredPlatformDto | null> {
        const item = await this.preferredPlatformRepository.findOneOrFail({
            where: { libraryUserId: userId, platformId },
            relations: this.RELATIONS,
        });

        return toDto(item);
    }

    async findAllByUserId(userId: string): Promise<PreferredPlatformDto[]> {
        const items = await this.preferredPlatformRepository.find({
            where: { libraryUserId: userId },
            relations: this.RELATIONS,
            order: { order: "ASC" },
        });

        return items.map(toDto);
    }

    async findAllActiveByUserId(
        userId: string,
    ): Promise<PreferredPlatformDto[]> {
        const items = await this.preferredPlatformRepository.find({
            where: { libraryUserId: userId, enabled: true },
            relations: this.RELATIONS,
            order: { order: "ASC" },
        });

        return items.map(toDto);
    }

    async createOrUpdate(userId: string, dto: CreatePreferredPlatformDto) {
        const existing = await this.findOneByUserIdAndPlatformId(
            userId,
            dto.platformId,
        );

        const maxOrder =
            await this.preferredPlatformReorderService.getMaxOrderValue(userId);
        const nextOrder = maxOrder + DEFAULT_ORDERING_GAP;

        await this.preferredPlatformRepository.save({
            ...existing,
            libraryUserId: userId,
            platformId: dto.platformId,
            order: existing ? existing.order : nextOrder,
            enabled: dto.isEnabled ?? true,
            label: dto.label,
        });
    }

    async delete(userId: string, platformId: number) {
        const existing = await this.findOneByUserIdAndPlatformId(
            userId,
            platformId,
        );

        if (!existing) {
            throw new HttpException("Preferred platform not found", 404);
        }

        await this.preferredPlatformRepository.softDelete({
            libraryUserId: userId,
            platformId,
        });
    }
}
