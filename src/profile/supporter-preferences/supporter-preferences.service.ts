import { Inject, Injectable, Logger } from "@nestjs/common";
import { CACHE_MANAGER, Cache } from "@nestjs/cache-manager";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, In } from "typeorm";
import { ProfileSupporterPreferences } from "../entities/profile-supporter-preferences.entity";
import {
    SUPPORTER_PREFERENCES_DEFAULTS,
    SupporterPreferencesValues,
} from "./supporter-preferences.defaults";
import {
    profilePresenceCacheKey,
    SUPPORTERS_WALL_CACHE_KEY,
} from "./supporter-preferences.cache";
import { UpdateSupporterPreferencesDto } from "./dto/update-supporter-preferences.dto";

@Injectable()
export class SupporterPreferencesService {
    private readonly logger = new Logger(SupporterPreferencesService.name);

    constructor(
        @InjectRepository(ProfileSupporterPreferences)
        private readonly repository: Repository<ProfileSupporterPreferences>,
        @Inject(CACHE_MANAGER) private readonly cache: Cache,
    ) {}

    async findOrDefaults(userId: string): Promise<SupporterPreferencesValues> {
        const row = await this.repository.findOneBy({ profileUserId: userId });
        return row ? this.valuesOf(row) : { ...SUPPORTER_PREFERENCES_DEFAULTS };
    }

    /**
     * Preferences for a batch of supporters in one query, defaulting missing rows. Callers pass
     * only ids already resolved as supporters.
     */
    async findOrDefaultsMany(
        userIds: string[],
    ): Promise<Map<string, SupporterPreferencesValues>> {
        const preferences = new Map<string, SupporterPreferencesValues>();
        const uniqueIds = [...new Set(userIds)];
        if (uniqueIds.length === 0) return preferences;

        const rows = await this.repository.find({
            where: { profileUserId: In(uniqueIds) },
        });
        const stored = new Map(rows.map((row) => [row.profileUserId, row]));
        for (const userId of uniqueIds) {
            const row = stored.get(userId);
            preferences.set(
                userId,
                row
                    ? this.valuesOf(row)
                    : { ...SUPPORTER_PREFERENCES_DEFAULTS },
            );
        }
        return preferences;
    }

    async update(
        userId: string,
        dto: UpdateSupporterPreferencesDto,
    ): Promise<SupporterPreferencesValues> {
        const changes: Partial<SupporterPreferencesValues> = {};
        if (dto.showBadge !== undefined) changes.showBadge = dto.showBadge;
        if (dto.titleKey !== undefined) changes.titleKey = dto.titleKey;
        if (dto.showAnimatedAvatarBorder !== undefined) {
            changes.showAnimatedAvatarBorder = dto.showAnimatedAvatarBorder;
        }
        if (dto.showSupporterTheme !== undefined) {
            changes.showSupporterTheme = dto.showSupporterTheme;
        }
        if (dto.accentColor !== undefined) {
            changes.accentColor = dto.accentColor;
        }
        if (dto.showOnSupportersWall !== undefined) {
            changes.showOnSupportersWall = dto.showOnSupportersWall;
        }
        if (dto.showLiveProfile !== undefined) {
            changes.showLiveProfile = dto.showLiveProfile;
        }

        // An empty body must neither write nor invalidate anything.
        if (Object.keys(changes).length === 0)
            return this.findOrDefaults(userId);

        await this.repository.upsert({ profileUserId: userId, ...changes }, [
            "profileUserId",
        ]);
        await this.invalidate(userId);
        return this.findOrDefaults(userId);
    }

    async findWallHiddenUserIds(): Promise<string[]> {
        const rows = await this.repository.find({
            where: { showOnSupportersWall: false },
            select: { profileUserId: true },
        });
        return rows.map((row) => row.profileUserId);
    }

    private valuesOf(
        row: ProfileSupporterPreferences,
    ): SupporterPreferencesValues {
        return {
            showBadge: row.showBadge,
            titleKey: row.titleKey,
            showAnimatedAvatarBorder: row.showAnimatedAvatarBorder,
            showSupporterTheme: row.showSupporterTheme,
            accentColor: row.accentColor,
            showOnSupportersWall: row.showOnSupportersWall,
            showLiveProfile: row.showLiveProfile,
        };
    }

    /** The TTL is the backstop, so a cache failure only gets logged (design 7). */
    private async invalidate(userId: string): Promise<void> {
        try {
            await Promise.all([
                this.cache.del(SUPPORTERS_WALL_CACHE_KEY),
                this.cache.del(profilePresenceCacheKey(userId)),
            ]);
        } catch (error) {
            this.logger.warn(
                `Could not invalidate supporter caches for ${userId}: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
    }
}
