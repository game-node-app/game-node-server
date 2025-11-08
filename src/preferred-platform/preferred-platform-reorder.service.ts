import { Injectable } from "@nestjs/common";
import { In, Repository } from "typeorm";
import { PreferredPlatform } from "./entity/preferred-platform.entity";
import { UpdatePreferredPlatformOrderDto } from "./dto/update-preferred-platform-order.dto";
import { InjectRepository } from "@nestjs/typeorm";
import {
    DEFAULT_ORDERING_GAP,
    DEFAULT_ORDERING_NORMALIZATION_THRESHOLD,
} from "../utils/ordering";

@Injectable()
export class PreferredPlatformReorderService {
    constructor(
        @InjectRepository(PreferredPlatform)
        private readonly preferredPlatformRepository: Repository<PreferredPlatform>,
    ) {}

    public async getMaxOrderValue(userId: string): Promise<number> {
        const result = await this.preferredPlatformRepository
            .createQueryBuilder("pp")
            .select("MAX(pp.order)", "max")
            .where("pp.libraryUserId = :userId", { userId })
            .getRawOne<{ max: number }>();

        return result?.max ?? 0;
    }

    public async reorderPreferredPlatforms(
        userId: string,
        dto: UpdatePreferredPlatformOrderDto,
    ): Promise<void> {
        const affectedEntities = await this.preferredPlatformRepository.findBy({
            libraryUserId: userId,
            platformId: In(
                [
                    dto.targetPlatformId,
                    dto.previousPlatformId,
                    dto.nextPlatformId,
                ].filter(Boolean),
            ),
        });

        const current = affectedEntities.find(
            (e) => e.platformId === dto.targetPlatformId,
        );
        const before = affectedEntities.find(
            (e) => e.platformId === dto.previousPlatformId,
        );
        const after = affectedEntities.find(
            (e) => e.platformId === dto.nextPlatformId,
        );

        if (!current) {
            throw new Error("Preferred platform to move not found.");
        }

        let newOrder: number;

        if (before && after) {
            newOrder = (before.order + after.order) / 2;
        } else if (before) {
            newOrder = before.order + DEFAULT_ORDERING_GAP;
        } else if (after) {
            newOrder = after.order - DEFAULT_ORDERING_GAP;
        } else {
            throw new Error(
                "At least one of previousId or nextId must be valid.",
            );
        }

        current.order = newOrder;

        await this.preferredPlatformRepository.update(
            {
                libraryUserId: userId,
                platformId: dto.targetPlatformId,
            },
            {
                order: newOrder,
            },
        );

        if (
            Math.abs(newOrder) < DEFAULT_ORDERING_NORMALIZATION_THRESHOLD ||
            !Number.isFinite(newOrder)
        ) {
            await this.normalizeOrdering(userId);
        }
    }

    private async normalizeOrdering(userId: string): Promise<void> {
        const entries = await this.preferredPlatformRepository.find({
            where: {
                libraryUserId: userId,
            },
            order: {
                order: "ASC",
            },
        });

        for (let i = 0; i < entries.length; i++) {
            entries[i].order = (i + 1) * DEFAULT_ORDERING_GAP;
        }

        await this.preferredPlatformRepository.save(entries);
    }
}
