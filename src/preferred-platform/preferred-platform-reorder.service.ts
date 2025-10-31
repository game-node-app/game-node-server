import { Injectable } from "@nestjs/common";
import { In, Repository } from "typeorm";
import { PreferredPlatform } from "./entity/preferred-platform.entity";
import { PreferredPlatformReorderDto } from "./dto/preferred-platform-reorder.dto";
import { PREFERRED_PLATFORM_ORDERING_GAP } from "./preferred-platform.constants";

@Injectable()
export class PreferredPlatformReorderService {
    constructor(
        private readonly preferredPlatformRepository: Repository<PreferredPlatform>,
    ) {}

    public async reorderPreferredPlatforms(
        userId: string,
        dto: PreferredPlatformReorderDto,
    ): Promise<void> {
        const affectedEntities = await this.preferredPlatformRepository.findBy({
            libraryUserId: userId,
            id: In([dto.id, dto.previousId, dto.nextId].filter(Boolean)),
        });

        const current = affectedEntities.find((e) => e.id === dto.id);
        const before = affectedEntities.find((e) => e.id === dto.previousId);
        const after = affectedEntities.find((e) => e.id === dto.nextId);

        if (!current) {
            throw new Error("Preferred platform to move not found.");
        }

        let newOrder: number;

        if (before && after) {
            newOrder = (before.order + after.order) / 2;
        } else if (before) {
            newOrder = before.order + PREFERRED_PLATFORM_ORDERING_GAP;
        } else if (after) {
            newOrder = after.order - PREFERRED_PLATFORM_ORDERING_GAP;
        } else {
            throw new Error(
                "At least one of previousId or nextId must be valid.",
            );
        }

        current.order = newOrder;
        await this.preferredPlatformRepository.save(current);
    }

    private async normalizeOrdering(userId: string): Promise<void> {
        const entries = await this.preferredPlatformRepository.findBy({
            libraryUserId: userId,
        });

        for (let i = 0; i < entries.length; i++) {
            entries[i].order = (i + 1) * PREFERRED_PLATFORM_ORDERING_GAP;
        }

        await this.preferredPlatformRepository.save(entries);
    }
}
