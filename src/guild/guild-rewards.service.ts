import { createHash } from "node:crypto";
import { ForbiddenException, Injectable } from "@nestjs/common";
import { DataSource, EntityManager, In } from "typeorm";
import {
    AchievementsProgressService,
    GrantedTier,
} from "../achievements/achievements-progress.service";
import { AchievementStatus } from "../achievements/achievements.constants";
import { AchievementDefinition } from "../achievements/entities/achievement-definition.entity";
import { Profile } from "../profile/entities/profile.entity";
import {
    DUPLICATE_COSMETIC_BONUS_XP,
    GuildRewardKind,
    seededOrder,
    toRewardDescriptor,
} from "./guild.constants";
import {
    GuildChestResultDto,
    GuildCosmeticsResponseDto,
    GuildRewardDescriptorDto,
    GuildRewardsResponseDto,
    UpdateGuildCosmeticsDto,
    UserGuildRewardDto,
} from "./dto/guild-rewards.dto";
import { GuildReward } from "./entities/guild-reward.entity";
import { UserGuildReward } from "./entities/user-guild-reward.entity";

export type GuildRewardFulfillment = {
    /** Extra Guild/global XP from duplicates and chest contents; contract XP is added by the caller. */
    bonusXp: number;
    unlockedRewards: GuildRewardDescriptorDto[];
    chestResult: GuildChestResultDto | null;
    /** Newly granted achievement tier; the caller registers its feed activity after commit. */
    pendingBadgeActivity: GrantedTier | null;
};

@Injectable()
export class GuildRewardsService {
    constructor(
        private readonly dataSource: DataSource,
        private readonly achievementsProgressService: AchievementsProgressService,
    ) {}

    async getUserRewards(userId: string): Promise<GuildRewardsResponseDto> {
        const [rewards, profile] = await Promise.all([
            this.dataSource.getRepository(UserGuildReward).find({
                where: { profileUserId: userId },
                relations: { reward: true },
                order: { unlockedAt: "DESC" },
            }),
            this.dataSource.getRepository(Profile).findOneBy({ userId }),
        ]);

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
        };
    }

    async updateCosmetics(
        userId: string,
        dto: UpdateGuildCosmeticsDto,
    ): Promise<GuildCosmeticsResponseDto> {
        // Both requested keys are checked before any write, so a rejected request changes nothing.
        if (dto.guildTitleKey != null) {
            await this.assertOwns(
                userId,
                dto.guildTitleKey,
                GuildRewardKind.TITLE,
            );
        }
        if (dto.guildFrameKey != null) {
            await this.assertOwns(
                userId,
                dto.guildFrameKey,
                GuildRewardKind.AVATAR_FRAME,
            );
        }

        const profile = await this.dataSource
            .getRepository(Profile)
            .findOneByOrFail({ userId });

        const changes: Partial<Profile> = {};
        if (dto.guildTitleKey !== undefined) {
            changes.guildTitleKey = dto.guildTitleKey;
        }
        if (dto.guildFrameKey !== undefined) {
            changes.guildFrameKey = dto.guildFrameKey;
        }
        if (Object.keys(changes).length > 0) {
            await this.dataSource
                .getRepository(Profile)
                .update({ userId }, changes);
        }

        return {
            guildTitleKey:
                changes.guildTitleKey !== undefined
                    ? changes.guildTitleKey
                    : profile.guildTitleKey,
            guildFrameKey:
                changes.guildFrameKey !== undefined
                    ? changes.guildFrameKey
                    : profile.guildFrameKey,
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
    ): Promise<GuildRewardFulfillment> {
        const fulfillment: GuildRewardFulfillment = {
            bonusXp: 0,
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
                }
                break;
            }
            case GuildRewardKind.TITLE:
            case GuildRewardKind.AVATAR_FRAME: {
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
            case GuildRewardKind.WEEKLY_CHEST: {
                fulfillment.bonusXp += reward.chestBonusXp;

                const [pool, owned] = await Promise.all([
                    manager.getRepository(GuildReward).find({
                        where: {
                            inChestPool: true,
                            isActive: true,
                            kind: In([
                                GuildRewardKind.TITLE,
                                GuildRewardKind.AVATAR_FRAME,
                            ]),
                        },
                    }),
                    manager.getRepository(UserGuildReward).find({
                        where: { profileUserId: userId },
                        select: { rewardId: true },
                    }),
                ]);
                const ownedIds = new Set(owned.map((row) => row.rewardId));
                // Design 16: unpicked cosmetics spread across the pool per user + contract.
                const candidate = seededOrder(
                    createHash("sha256")
                        .update(`${userId}:${contractId}`)
                        .digest(),
                    pool,
                    (cosmetic) => cosmetic.id,
                ).find((cosmetic) => !ownedIds.has(cosmetic.id));

                let unlockedCosmetic: GuildRewardDescriptorDto | null = null;
                if (
                    candidate &&
                    (await this.insertCosmetic(
                        manager,
                        userId,
                        candidate,
                        contractId,
                        now,
                    ))
                ) {
                    unlockedCosmetic = toRewardDescriptor(candidate);
                    fulfillment.unlockedRewards.push(unlockedCosmetic);
                } else {
                    fulfillment.bonusXp += DUPLICATE_COSMETIC_BONUS_XP;
                }

                fulfillment.chestResult = {
                    bonusXp:
                        reward.chestBonusXp +
                        (unlockedCosmetic ? 0 : DUPLICATE_COSMETIC_BONUS_XP),
                    unlockedCosmetic,
                };
                break;
            }
        }

        return fulfillment;
    }

    private async assertOwns(
        userId: string,
        key: string,
        kind: GuildRewardKind,
    ) {
        const owned = await this.dataSource
            .getRepository(UserGuildReward)
            .findOne({
                where: { profileUserId: userId, reward: { key, kind } },
                relations: { reward: true },
            });
        if (!owned) {
            throw new ForbiddenException({
                message: "You do not own this Guild cosmetic.",
                code: "guild_cosmetic_not_owned",
            });
        }
    }

    private async insertCosmetic(
        manager: EntityManager,
        userId: string,
        reward: GuildReward,
        contractId: string,
        unlockedAt: Date,
    ): Promise<boolean> {
        const result = await manager.query(
            "INSERT IGNORE INTO user_guild_reward (profileUserId, rewardId, sourceContractId, unlockedAt) VALUES (?, ?, ?, ?)",
            [userId, reward.id, contractId, unlockedAt],
        );
        return result.affectedRows > 0;
    }
}
