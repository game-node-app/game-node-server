import { Injectable } from "@nestjs/common";
import { DataSource, EntityManager, In } from "typeorm";
import {
    GuildRewardDescriptorDto,
    GuildChestResultDto,
} from "./dto/guild-rewards.dto";
import { GuildProfile } from "./entities/guild-profile.entity";
import { GuildReward } from "./entities/guild-reward.entity";
import {
    GUILD_RANK_ORDER,
    GUILD_RANK_PROMOTION_REWARDS,
    GuildRank,
    GuildRewardKind,
    GuildSealReason,
    computeGuildPrestige,
    computeGuildRank,
    toRewardDescriptor,
} from "./guild.constants";
import { GuildRewardsService } from "./guild-rewards.service";

export type GuildRankPromotionGrant = {
    rank: GuildRank;
    unlockedRewards: GuildRewardDescriptorDto[];
};

export type GuildRankPromotionResult = {
    highestPromotedRank: GuildRank;
    promotions: GuildRankPromotionGrant[];
    unlockedRewards: GuildRewardDescriptorDto[];
};

export type GuildPrestigeGrantResult = {
    prestigeLevel: number;
    starsGranted: number;
    chestResults: GuildChestResultDto[];
    sealsAwarded: number;
};

const PROMOTION_RANKS = [
    GuildRank.D,
    GuildRank.C,
    GuildRank.B,
    GuildRank.A,
    GuildRank.S,
] as const;

const emptyPromotions = (rank: GuildRank): GuildRankPromotionResult => ({
    highestPromotedRank: rank,
    promotions: [],
    unlockedRewards: [],
});

/**
 * One-time Rank promotion packages and endless Prestige S+ stars (design 8).
 * Both mutate only inside the caller's transaction under a `guild_profile` lock.
 */
@Injectable()
export class GuildRankProgressionService {
    constructor(
        private readonly dataSource: DataSource,
        private readonly guildRewardsService: GuildRewardsService,
    ) {}

    /**
     * Grants every promotion package crossed since `highestPromotedRank`, in rank order,
     * so a multi-rank jump never skips a package.
     */
    async grantRankPromotionsWithManager(
        manager: EntityManager,
        profile: GuildProfile,
        sourceRef: string | null,
        now = new Date(),
    ): Promise<GuildRankPromotionResult> {
        const current = await this.lockProfile(manager, profile.profileUserId);
        const targetRank = computeGuildRank(current.xp).rank;
        const alreadyGranted =
            GUILD_RANK_ORDER[current.highestPromotedRank] ?? 0;
        const promotions: GuildRankPromotionGrant[] = [];

        for (const rank of PROMOTION_RANKS) {
            if (GUILD_RANK_ORDER[rank] <= alreadyGranted) continue;
            if (GUILD_RANK_ORDER[rank] > GUILD_RANK_ORDER[targetRank]) break;
            promotions.push({
                rank,
                unlockedRewards: await this.grantPackage(
                    manager,
                    current.profileUserId,
                    rank,
                    sourceRef,
                    now,
                ),
            });
        }

        const highestPromotedRank =
            GUILD_RANK_ORDER[targetRank] > alreadyGranted
                ? targetRank
                : current.highestPromotedRank;
        if (
            highestPromotedRank !== current.highestPromotedRank ||
            current.rank !== targetRank
        ) {
            await manager.query(
                "UPDATE guild_profile SET highestPromotedRank = ?, `rank` = ? WHERE profileUserId = ?",
                [highestPromotedRank, targetRank, current.profileUserId],
            );
        }

        return {
            highestPromotedRank,
            promotions,
            unlockedRewards: promotions.flatMap(
                (promotion) => promotion.unlockedRewards,
            ),
        };
    }

    /**
     * Lazy one-time reconciliation for members who ranked up before this migration.
     * A plain read short-circuits without a transaction once nothing is pending.
     */
    async reconcileRankPromotionsIfNeeded(
        userId: string,
    ): Promise<GuildRankPromotionResult> {
        const profile = await this.dataSource
            .getRepository(GuildProfile)
            .findOneBy({ profileUserId: userId });
        if (!profile) return emptyPromotions(GuildRank.E);

        const targetRank = computeGuildRank(profile.xp).rank;
        if (
            GUILD_RANK_ORDER[profile.highestPromotedRank] >=
            GUILD_RANK_ORDER[targetRank]
        ) {
            return emptyPromotions(profile.highestPromotedRank);
        }

        return this.dataSource.transaction((manager) =>
            this.grantRankPromotionsWithManager(manager, profile, null),
        );
    }

    /**
     * Opens one `chest_relic` per newly reached Prestige star and credits its Seals
     * inside the granting transaction. The chest XP is intentionally not applied:
     * Prestige must never feed its own next star.
     */
    async grantPrestigeStarsWithManager(
        manager: EntityManager,
        profile: GuildProfile,
        sourceRef: string | null,
        now = new Date(),
    ): Promise<GuildPrestigeGrantResult> {
        const current = await this.lockProfile(manager, profile.profileUserId);
        const targetLevel = computeGuildPrestige(current.xp).prestigeLevel;
        const starsGranted = Math.max(0, targetLevel - current.prestigeLevel);
        const chestResults: GuildChestResultDto[] = [];
        let sealsAwarded = 0;

        for (
            let level = current.prestigeLevel + 1;
            level <= targetLevel;
            level++
        ) {
            const chest = await this.guildRewardsService.openChestWithManager(
                manager,
                current.profileUserId,
                GuildRewardKind.CHEST_RELIC,
                `${sourceRef ?? "prestige"}:prestige:${level}`,
                now,
                { sealReason: GuildSealReason.PRESTIGE_STAR },
            );
            chestResults.push(chest);
            sealsAwarded += chest.bonusSeals;
        }

        if (starsGranted > 0) {
            await manager.query(
                "UPDATE guild_profile SET prestigeLevel = ? WHERE profileUserId = ?",
                [targetLevel, current.profileUserId],
            );
        }

        return {
            prestigeLevel: Math.max(current.prestigeLevel, targetLevel),
            starsGranted,
            chestResults,
            sealsAwarded,
        };
    }

    private async grantPackage(
        manager: EntityManager,
        userId: string,
        rank: GuildRank,
        sourceRef: string | null,
        now: Date,
    ): Promise<GuildRewardDescriptorDto[]> {
        const keys = GUILD_RANK_PROMOTION_REWARDS[rank];
        if (keys.length === 0) return [];

        const rewards = await manager.getRepository(GuildReward).find({
            where: { key: In([...keys]) },
        });
        const byKey = new Map(rewards.map((reward) => [reward.key, reward]));

        const unlocked: GuildRewardDescriptorDto[] = [];
        for (const key of keys) {
            const reward = byKey.get(key);
            if (!reward) continue;
            const result = await manager.query(
                "INSERT IGNORE INTO user_guild_reward (profileUserId, rewardId, sourceContractId, unlockedAt) VALUES (?, ?, ?, ?)",
                [userId, reward.id, sourceRef?.slice(0, 36) ?? null, now],
            );
            if (result.affectedRows > 0) {
                unlocked.push(toRewardDescriptor(reward));
            }
        }
        return unlocked;
    }

    private async lockProfile(
        manager: EntityManager,
        userId: string,
    ): Promise<GuildProfile> {
        await manager.query(
            "SELECT profileUserId FROM guild_profile WHERE profileUserId = ? FOR UPDATE",
            [userId],
        );
        return manager
            .getRepository(GuildProfile)
            .findOneByOrFail({ profileUserId: userId });
    }
}
