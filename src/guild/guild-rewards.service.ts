import { createHash } from "node:crypto";
import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    Optional,
} from "@nestjs/common";
import { DataSource, EntityManager, In } from "typeorm";
import {
    AchievementsProgressService,
    GrantedTier,
} from "../achievements/achievements-progress.service";
import { AchievementStatus } from "../achievements/achievements.constants";
import { AchievementDefinition } from "../achievements/entities/achievement-definition.entity";
import { ObtainedAchievement } from "../achievements/entities/obtained-achievement.entity";
import { Profile } from "../profile/entities/profile.entity";
import {
    DUPLICATE_BADGE_BONUS_SEALS,
    DUPLICATE_COSMETIC_BONUS_XP,
    GuildChestKind,
    GuildChestTierKey,
    GuildConsumableKey,
    GuildRewardKind,
    GuildRewardRarity,
    GuildSealReason,
    resolveGuildChestTier,
    seededOrder,
    toRewardDescriptor,
    upgradeGuildChestTier,
} from "./guild.constants";
import {
    GuildChestResultDto,
    GuildConsumableBalancesDto,
    GuildCosmeticsResponseDto,
    GuildRewardDescriptorDto,
    GuildRewardsResponseDto,
    UpdateGuildCosmeticsDto,
    UserGuildRewardDto,
} from "./dto/guild-rewards.dto";
import { GuildProfile } from "./entities/guild-profile.entity";
import { GuildReward } from "./entities/guild-reward.entity";
import { UserGuildReward } from "./entities/user-guild-reward.entity";
import { GuildSealsService } from "./guild-seals.service";

export type GuildRewardFulfillment = {
    /** Extra Guild/global XP from duplicates and chest contents; contract XP is added by the caller. */
    bonusXp: number;
    /**
     * Seals already credited in the caller's transaction (chest payout and duplicate
     * fallback); callers must not credit them again.
     */
    bonusSeals: number;
    unlockedRewards: GuildRewardDescriptorDto[];
    chestResult: GuildChestResultDto | null;
    /** Newly granted achievement tier; the caller registers its feed activity after commit. */
    pendingBadgeActivity: GrantedTier | null;
};

export type GuildChestOpenOptions = {
    /** Bonus objectives upgrade a chest one tier before it opens (design 4). */
    upgradeChestTier?: boolean;
    /** Ledger reason for the chest's Seal payout; defaults to `chest_payout`. */
    sealReason?: GuildSealReason;
};

const CHEST_POOL_KINDS = [
    GuildRewardKind.TITLE,
    GuildRewardKind.AVATAR_FRAME,
    GuildRewardKind.LICENSE_THEME,
    GuildRewardKind.STAMP_STYLE,
    GuildRewardKind.TAVERN_DECOR,
];

const MAX_DECOR_SLOTS = 4;
const MAX_SHOWCASE_BADGES = 3;

@Injectable()
export class GuildRewardsService {
    private readonly sealsService: GuildSealsService;

    constructor(
        private readonly dataSource: DataSource,
        private readonly achievementsProgressService: AchievementsProgressService,
        @Optional() sealsService?: GuildSealsService,
    ) {
        // Optional so existing direct constructions (and module wiring before
        // GuildSealsService is registered) keep working unchanged.
        this.sealsService = sealsService ?? new GuildSealsService(dataSource);
    }

    async getUserRewards(userId: string): Promise<GuildRewardsResponseDto> {
        const [rewards, profile, guildProfile, consumables] = await Promise.all(
            [
                this.dataSource.getRepository(UserGuildReward).find({
                    where: { profileUserId: userId },
                    relations: { reward: true },
                    order: { unlockedAt: "DESC" },
                }),
                this.dataSource.getRepository(Profile).findOneBy({ userId }),
                this.dataSource
                    .getRepository(GuildProfile)
                    .findOneBy({ profileUserId: userId }),
                this.sealsService.getConsumableBalances(userId),
            ],
        );

        return {
            unlockedRewards: rewards.map(
                ({
                    id,
                    reward,
                    sourceContractId,
                    unlockedAt,
                }): UserGuildRewardDto => ({
                    id,
                    reward: toRewardDescriptor(reward),
                    sourceContractId,
                    unlockedAt,
                }),
            ),
            equippedTitleKey: profile?.guildTitleKey ?? null,
            equippedFrameKey: profile?.guildFrameKey ?? null,
            equippedLicenseThemeKey:
                guildProfile?.equippedLicenseThemeKey ?? null,
            equippedStampStyleKey: guildProfile?.equippedStampStyleKey ?? null,
            equippedDecorKeys: guildProfile?.equippedDecorKeys ?? [],
            showcaseBadgeIds: guildProfile?.showcaseBadgeIds ?? [],
            sealsBalance: guildProfile?.sealsBalance ?? 0,
            consumables: { ...consumables } as GuildConsumableBalancesDto,
        };
    }

    async updateCosmetics(
        userId: string,
        dto: UpdateGuildCosmeticsDto,
    ): Promise<GuildCosmeticsResponseDto> {
        this.assertDistinctWithin(
            dto.equippedDecorKeys,
            MAX_DECOR_SLOTS,
            "decor",
        );
        this.assertDistinctWithin(
            dto.showcaseBadgeIds,
            MAX_SHOWCASE_BADGES,
            "showcase",
        );

        // Every requested key is checked before any write, so a rejected request changes nothing.
        await Promise.all([
            dto.guildTitleKey != null
                ? this.assertOwnsKeys(
                      userId,
                      [dto.guildTitleKey],
                      GuildRewardKind.TITLE,
                  )
                : null,
            dto.guildFrameKey != null
                ? this.assertOwnsKeys(
                      userId,
                      [dto.guildFrameKey],
                      GuildRewardKind.AVATAR_FRAME,
                  )
                : null,
            dto.equippedLicenseThemeKey != null
                ? this.assertOwnsKeys(
                      userId,
                      [dto.equippedLicenseThemeKey],
                      GuildRewardKind.LICENSE_THEME,
                  )
                : null,
            dto.equippedStampStyleKey != null
                ? this.assertOwnsKeys(
                      userId,
                      [dto.equippedStampStyleKey],
                      GuildRewardKind.STAMP_STYLE,
                  )
                : null,
            dto.equippedDecorKeys?.length
                ? this.assertOwnsKeys(
                      userId,
                      dto.equippedDecorKeys,
                      GuildRewardKind.TAVERN_DECOR,
                  )
                : null,
            dto.showcaseBadgeIds?.length
                ? this.assertOwnsAchievements(userId, dto.showcaseBadgeIds)
                : null,
        ]);

        await this.dataSource.query(
            "INSERT IGNORE INTO guild_profile (profileUserId) VALUES (?)",
            [userId],
        );
        const [profile, guildProfile] = await Promise.all([
            this.dataSource.getRepository(Profile).findOneByOrFail({ userId }),
            this.dataSource
                .getRepository(GuildProfile)
                .findOneByOrFail({ profileUserId: userId }),
        ]);

        const profileChanges: Partial<Profile> = {};
        if (dto.guildTitleKey !== undefined) {
            profileChanges.guildTitleKey = dto.guildTitleKey;
        }
        if (dto.guildFrameKey !== undefined) {
            profileChanges.guildFrameKey = dto.guildFrameKey;
        }
        if (Object.keys(profileChanges).length > 0) {
            await this.dataSource
                .getRepository(Profile)
                .update({ userId }, profileChanges);
        }

        // Guild-only cosmetics stay on guild_profile: GET /v1/profile/:id never reads them.
        const guildChanges: Partial<GuildProfile> = {};
        if (dto.equippedLicenseThemeKey !== undefined) {
            guildChanges.equippedLicenseThemeKey = dto.equippedLicenseThemeKey;
        }
        if (dto.equippedStampStyleKey !== undefined) {
            guildChanges.equippedStampStyleKey = dto.equippedStampStyleKey;
        }
        if (dto.equippedDecorKeys !== undefined) {
            guildChanges.equippedDecorKeys = dto.equippedDecorKeys;
        }
        if (dto.showcaseBadgeIds !== undefined) {
            guildChanges.showcaseBadgeIds = dto.showcaseBadgeIds;
        }
        if (Object.keys(guildChanges).length > 0) {
            await this.dataSource
                .getRepository(GuildProfile)
                .update({ profileUserId: userId }, guildChanges);
        }

        return {
            guildTitleKey:
                profileChanges.guildTitleKey !== undefined
                    ? profileChanges.guildTitleKey
                    : profile.guildTitleKey,
            guildFrameKey:
                profileChanges.guildFrameKey !== undefined
                    ? profileChanges.guildFrameKey
                    : profile.guildFrameKey,
            equippedLicenseThemeKey:
                guildChanges.equippedLicenseThemeKey !== undefined
                    ? guildChanges.equippedLicenseThemeKey
                    : guildProfile.equippedLicenseThemeKey,
            equippedStampStyleKey:
                guildChanges.equippedStampStyleKey !== undefined
                    ? guildChanges.equippedStampStyleKey
                    : guildProfile.equippedStampStyleKey,
            equippedDecorKeys:
                guildChanges.equippedDecorKeys !== undefined
                    ? (guildChanges.equippedDecorKeys ?? [])
                    : (guildProfile.equippedDecorKeys ?? []),
            showcaseBadgeIds:
                guildChanges.showcaseBadgeIds !== undefined
                    ? (guildChanges.showcaseBadgeIds ?? [])
                    : (guildProfile.showcaseBadgeIds ?? []),
        };
    }

    /**
     * Grants the reward of a claimed contract inside the caller's transaction (design 6).
     */
    async fulfillContractRewardWithManager(
        manager: EntityManager,
        userId: string,
        contractId: string,
        rewardId: string | null,
        now = new Date(),
        options: GuildChestOpenOptions = {},
    ): Promise<GuildRewardFulfillment> {
        const fulfillment: GuildRewardFulfillment = {
            bonusXp: 0,
            bonusSeals: 0,
            unlockedRewards: [],
            chestResult: null,
            pendingBadgeActivity: null,
        };
        if (!rewardId) return fulfillment;

        const reward = await manager
            .getRepository(GuildReward)
            .findOneBy({ id: rewardId });
        if (!reward) return fulfillment;

        switch (reward.kind) {
            case GuildRewardKind.BADGE: {
                if (!reward.achievementId) break;
                const definition = await manager
                    .getRepository(AchievementDefinition)
                    .findOne({
                        where: { id: reward.achievementId },
                        relations: { tiers: true },
                    });
                if (definition?.status !== AchievementStatus.PUBLISHED) break;

                const granted =
                    await this.achievementsProgressService.grantTiersWithManager(
                        manager,
                        userId,
                        definition,
                        [1],
                        "live",
                    );
                if (granted) {
                    fulfillment.unlockedRewards.push(
                        toRewardDescriptor(reward),
                    );
                    fulfillment.pendingBadgeActivity = granted;
                } else {
                    // Repeating a badge quest must never pay less than a chest quest.
                    fulfillment.bonusXp += DUPLICATE_COSMETIC_BONUS_XP;
                    fulfillment.bonusSeals += DUPLICATE_BADGE_BONUS_SEALS;
                    await this.sealsService.creditSealsWithManager(
                        manager,
                        userId,
                        DUPLICATE_BADGE_BONUS_SEALS,
                        GuildSealReason.DUPLICATE_FALLBACK,
                        contractId,
                    );
                }
                break;
            }
            case GuildRewardKind.TITLE:
            case GuildRewardKind.AVATAR_FRAME:
            case GuildRewardKind.LICENSE_THEME:
            case GuildRewardKind.STAMP_STYLE:
            case GuildRewardKind.TAVERN_DECOR: {
                const inserted = await this.insertCosmetic(
                    manager,
                    userId,
                    reward,
                    contractId,
                    now,
                );
                if (inserted) {
                    fulfillment.unlockedRewards.push(
                        toRewardDescriptor(reward),
                    );
                } else {
                    fulfillment.bonusXp += DUPLICATE_COSMETIC_BONUS_XP;
                }
                break;
            }
            case GuildRewardKind.CONSUMABLE: {
                if (!reward.consumableKey) break;
                await this.sealsService.grantConsumableWithManager(
                    manager,
                    userId,
                    reward.consumableKey,
                    1,
                );
                fulfillment.unlockedRewards.push(toRewardDescriptor(reward));
                break;
            }
            case GuildRewardKind.WEEKLY_CHEST:
            case GuildRewardKind.CHEST_BRONZE:
            case GuildRewardKind.CHEST_SILVER:
            case GuildRewardKind.CHEST_GOLD:
            case GuildRewardKind.CHEST_RELIC: {
                const chest = await this.openChestWithManager(
                    manager,
                    userId,
                    reward.kind,
                    contractId,
                    now,
                    options,
                );
                fulfillment.bonusXp += chest.bonusXp;
                fulfillment.bonusSeals += chest.bonusSeals;
                fulfillment.chestResult = chest;
                if (chest.unlockedCosmetic) {
                    fulfillment.unlockedRewards.push(chest.unlockedCosmetic);
                }
                break;
            }
        }

        return fulfillment;
    }

    /**
     * Opens a tiered chest inside the caller's transaction: deterministically unlocks
     * one unowned cosmetic from the tier's rarity band, rolls consumable drops, and
     * converts an exhausted pool into extra XP/Seals. Seals are credited here.
     */
    async openChestWithManager(
        manager: EntityManager,
        userId: string,
        chestKind: GuildChestKind,
        sourceId: string,
        now = new Date(),
        options: GuildChestOpenOptions = {},
    ): Promise<GuildChestResultDto> {
        const tier = resolveGuildChestTier(
            options.upgradeChestTier
                ? upgradeGuildChestTier(chestKind)
                : chestKind,
        );
        const seed = createHash("sha256")
            .update(`${userId}:${sourceId}`)
            .digest();
        const rarities = [...tier.poolRarities, ...tier.fallbackRarities];

        const [pool, owned] = await Promise.all([
            manager.getRepository(GuildReward).find({
                where: {
                    inChestPool: true,
                    isActive: true,
                    kind: In(CHEST_POOL_KINDS),
                    rarity: In(rarities),
                },
            }),
            manager.getRepository(UserGuildReward).find({
                where: { profileUserId: userId },
                select: { rewardId: true },
            }),
        ]);
        const ownedIds = new Set(owned.map((row) => row.rewardId));
        const ordered = seededOrder(seed, pool, (cosmetic) => cosmetic.id);
        const candidate =
            ordered.find(
                (cosmetic) =>
                    tier.poolRarities.includes(cosmetic.rarity) &&
                    !ownedIds.has(cosmetic.id),
            ) ??
            ordered.find(
                (cosmetic) =>
                    tier.fallbackRarities.includes(cosmetic.rarity) &&
                    !ownedIds.has(cosmetic.id),
            );

        let unlockedCosmetic: GuildRewardDescriptorDto | null = null;
        if (
            candidate &&
            (await this.insertCosmetic(
                manager,
                userId,
                candidate,
                sourceId,
                now,
            ))
        ) {
            unlockedCosmetic = toRewardDescriptor(candidate);
        }

        const grantedConsumable = await this.rollChestConsumable(
            manager,
            userId,
            tier.kind,
            tier.consumableKeys,
            tier.consumableDropChance,
            seed,
        );
        const bonusXp =
            tier.bonusXp + (unlockedCosmetic ? 0 : tier.exhaustedBonusXp);
        const bonusSeals =
            tier.bonusSeals + (unlockedCosmetic ? 0 : tier.exhaustedBonusSeals);
        if (bonusSeals > 0) {
            await this.sealsService.creditSealsWithManager(
                manager,
                userId,
                bonusSeals,
                options.sealReason ?? GuildSealReason.CHEST_PAYOUT,
                sourceId,
            );
        }

        return {
            chestKind: tier.kind,
            bonusXp,
            bonusSeals,
            unlockedCosmetic,
            grantedConsumable,
        };
    }

    private async rollChestConsumable(
        manager: EntityManager,
        userId: string,
        chestKind: GuildChestTierKey,
        consumableKeys: readonly GuildConsumableKey[],
        dropChance: number,
        seed: Buffer,
    ): Promise<GuildConsumableKey | null> {
        if (consumableKeys.length === 0 || dropChance <= 0) return null;
        const roll =
            createHash("sha256")
                .update(seed)
                .update(`${chestKind}:consumable`)
                .digest()[0] / 256;
        if (roll >= dropChance) return null;

        const [consumableKey] = seededOrder(
            createHash("sha256")
                .update(seed)
                .update(`${chestKind}:key`)
                .digest(),
            consumableKeys,
            (key) => key,
        );
        await this.sealsService.grantConsumableWithManager(
            manager,
            userId,
            consumableKey,
            1,
        );
        return consumableKey;
    }

    private async assertOwnsKeys(
        userId: string,
        keys: readonly string[],
        kind: GuildRewardKind,
    ) {
        const owned = await this.dataSource
            .getRepository(UserGuildReward)
            .find({
                where: {
                    profileUserId: userId,
                    reward: { key: In([...keys]), kind },
                },
                relations: { reward: true },
            });
        const ownedKeys = new Set(owned.map(({ reward }) => reward.key));
        if (keys.some((key) => !ownedKeys.has(key))) {
            throw new ForbiddenException({
                message: "You do not own this Guild cosmetic.",
                code: "guild_cosmetic_not_owned",
            });
        }
    }

    private async assertOwnsAchievements(
        userId: string,
        achievementIds: readonly string[],
    ) {
        const owned = await this.dataSource
            .getRepository(ObtainedAchievement)
            .find({
                where: {
                    profileUserId: userId,
                    achievementId: In([...achievementIds]),
                },
                select: { achievementId: true },
            });
        const ownedIds = new Set(owned.map((row) => row.achievementId));
        if (achievementIds.some((id) => !ownedIds.has(id))) {
            throw new ForbiddenException({
                message: "You do not own this Guild badge.",
                code: "guild_cosmetic_not_owned",
            });
        }
    }

    private assertDistinctWithin(
        values: readonly string[] | null | undefined,
        limit: number,
        label: string,
    ) {
        if (values == null) return;
        if (values.length > limit || new Set(values).size !== values.length) {
            throw new BadRequestException({
                message: `Guild ${label} allows at most ${limit} distinct keys.`,
                code: "guild_cosmetic_limit_exceeded",
            });
        }
    }

    private async insertCosmetic(
        manager: EntityManager,
        userId: string,
        reward: GuildReward,
        sourceContractId: string | null,
        unlockedAt: Date,
    ): Promise<boolean> {
        const result = await manager.query(
            "INSERT IGNORE INTO user_guild_reward (profileUserId, rewardId, sourceContractId, unlockedAt) VALUES (?, ?, ?, ?)",
            [
                userId,
                reward.id,
                sourceContractId?.slice(0, 36) ?? null,
                unlockedAt,
            ],
        );
        return result.affectedRows > 0;
    }
}
