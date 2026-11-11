import { Inject, Injectable } from "@nestjs/common";
import { CACHE_MANAGER, Cache } from "@nestjs/cache-manager";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { AuthService } from "../auth/auth.service";
import { BillingService } from "../billing/billing.service";
import { Profile } from "../profile/entities/profile.entity";
import { SUPPORTERS_WALL_CACHE_KEY } from "../profile/supporter-preferences/supporter-preferences.cache";
import { SupporterPreferencesService } from "../profile/supporter-preferences/supporter-preferences.service";
import { listToPaginationData } from "../utils/pagination/listToPaginationData";
import { TPaginationData } from "../utils/pagination/pagination-response.dto";
import { SupporterWallItemDto } from "./dto/supporters-wall.dto";

const SUPPORTERS_WALL_CACHE_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class SupportersService {
    constructor(
        @InjectRepository(Profile)
        private readonly profileRepository: Repository<Profile>,
        private readonly billingService: BillingService,
        private readonly authService: AuthService,
        private readonly supporterPreferencesService: SupporterPreferencesService,
        @Inject(CACHE_MANAGER) private readonly cache: Cache,
    ) {}

    /**
     * shortcut: whole supporter list in one cache entry; upgrade to a paged query when the list passes a few thousand.
     */
    async getWall(
        offset = 0,
        limit = 20,
    ): Promise<TPaginationData<SupporterWallItemDto>> {
        const cached = await this.cache
            .get<SupporterWallItemDto[]>(SUPPORTERS_WALL_CACHE_KEY)
            .catch(() => undefined);
        if (cached != null) {
            return listToPaginationData(cached, offset, limit);
        }

        const supporterIds = await this.billingService.findSupporterUserIds();
        const [lockouts, hiddenIds] = await Promise.all([
            this.authService.getLockoutStates(supporterIds),
            this.supporterPreferencesService.findWallHiddenUserIds(),
        ]);
        const hidden = new Set(hiddenIds);
        const visibleIds = supporterIds.filter((userId) => {
            const lockout = lockouts.get(userId);
            return (
                !hidden.has(userId) &&
                !lockout?.isBanned &&
                !lockout?.isSuspended
            );
        });

        // The query only returns existing profiles, so ids without one drop out.
        const profiles = visibleIds.length
            ? await this.profileRepository.find({
                  where: { userId: In(visibleIds) },
                  relations: { avatar: true },
                  order: { username: "ASC" },
              })
            : [];
        const items = profiles.map(
            ({ userId, username, avatar }): SupporterWallItemDto => ({
                userId,
                username,
                avatar,
            }),
        );

        await this.cache
            .set(SUPPORTERS_WALL_CACHE_KEY, items, SUPPORTERS_WALL_CACHE_TTL_MS)
            .catch(() => undefined);
        return listToPaginationData(items, offset, limit);
    }
}
