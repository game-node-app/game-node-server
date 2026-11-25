import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { DataSource, EntityManager } from "typeorm";
import { createAwardsTestDatabase } from "../../test/awards/awards-test-database";
import { AchievementsProgressService } from "../achievements/achievements-progress.service";
import { LevelService } from "../level/level.service";
import { UserLevel } from "../level/entities/user-level.entity";
import { Profile } from "../profile/entities/profile.entity";
import { GuildProfile } from "./entities/guild-profile.entity";
import { GuildReward } from "./entities/guild-reward.entity";
import { GuildSealLedger } from "./entities/guild-seal-ledger.entity";
import {
    GUILD_RANK_PROMOTION_REWARDS,
    GuildRank,
    GuildRewardKind,
    GuildRewardRarity,
    GuildSealReason,
    computeGuildRank,
    computeGuildPrestige,
} from "./guild.constants";
import { GuildRankProgressionService } from "./guild-rank-progression.service";
import { GuildRewardsService } from "./guild-rewards.service";
import { GuildSealsService } from "./guild-seals.service";

const kindForKey = (key: string): GuildRewardKind => {
    if (key.startsWith("frame_")) return GuildRewardKind.AVATAR_FRAME;
    if (key.startsWith("decor_")) return GuildRewardKind.TAVERN_DECOR;
    if (key.startsWith("license_")) return GuildRewardKind.LICENSE_THEME;
    if (key.startsWith("stamp_")) return GuildRewardKind.STAMP_STYLE;
    return GuildRewardKind.TITLE;
};

describe("GuildRankProgressionService (integration)", () => {
    jest.setTimeout(120000);

    const database = `guild_test_ranks_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    let db: Awaited<ReturnType<typeof createAwardsTestDatabase>>;
    let source: DataSource;
    let progression: GuildRankProgressionService;
    let seals: GuildSealsService;

    beforeAll(async () => {
        db = await createAwardsTestDatabase(database);
        source = db.source;
        seals = new GuildSealsService(source);
        const achievements = new AchievementsProgressService(
            source,
            new LevelService(source.getRepository(UserLevel)),
            { register: jest.fn() } as any,
        );
        const rewards = new GuildRewardsService(source, achievements, seals);
        progression = new GuildRankProgressionService(source, rewards);

        // The test schema is synchronized from entities, so the migration's seeds
        // are recreated here for the promotion packages and the Relic chest pool.
        for (const keys of Object.values(GUILD_RANK_PROMOTION_REWARDS)) {
            for (const key of keys) {
                await source.getRepository(GuildReward).save({
                    id: randomUUID(),
                    key,
                    kind: kindForKey(key),
                    achievementId: null,
                    inChestPool: false,
                    chestBonusXp: 0,
                    chestBonusSeals: 0,
                    rarity: GuildRewardRarity.RARE,
                    consumableKey: null,
                    isActive: true,
                });
            }
        }
        for (const rarity of [
            GuildRewardRarity.LEGENDARY,
            GuildRewardRarity.LEGENDARY,
            GuildRewardRarity.EPIC,
        ]) {
            await source.getRepository(GuildReward).save({
                id: randomUUID(),
                key: `chest_pool_${randomUUID().slice(0, 8)}`,
                kind: GuildRewardKind.TITLE,
                achievementId: null,
                inChestPool: true,
                chestBonusXp: 0,
                chestBonusSeals: 0,
                rarity,
                consumableKey: null,
                isActive: true,
            });
        }
    });

    afterAll(async () => {
        await db?.destroy();
    });

    const createProfile = async (
        xp: number,
        overrides: Partial<GuildProfile> = {},
    ) => {
        const userId = randomUUID();
        await source.getRepository(Profile).insert({
            userId,
            username: `g${userId.slice(0, 18)}`,
        });
        await source.getRepository(GuildProfile).insert({
            profileUserId: userId,
            xp,
            rank: computeGuildRank(xp).rank,
            ...overrides,
        });
        return userId;
    };

    const profileOf = (userId: string) =>
        source
            .getRepository(GuildProfile)
            .findOneByOrFail({ profileUserId: userId });

    const unlockedKeysOf = async (userId: string) =>
        (
            await source.query(
                "SELECT gr.`key` AS `key` FROM user_guild_reward ugr JOIN guild_reward gr ON gr.id = ugr.rewardId WHERE ugr.profileUserId = ? ORDER BY gr.`key`",
                [userId],
            )
        ).map((row: { key: string }) => row.key);

    const ledgerOf = (userId: string) =>
        source.getRepository(GuildSealLedger).find({
            where: { profileUserId: userId },
            order: { id: "ASC" },
        });

    const transaction = <T>(work: (manager: EntityManager) => Promise<T>) =>
        source.transaction(work);

    describe("Rank promotion packages", () => {
        it("grants a single rank package once and stores its source contract", async () => {
            const userId = await createProfile(350);
            const profile = await profileOf(userId);

            const first = await transaction((manager) =>
                progression.grantRankPromotionsWithManager(
                    manager,
                    profile,
                    "contract-1",
                ),
            );

            expect(first.highestPromotedRank).toBe(GuildRank.D);
            expect(first.promotions.map(({ rank }) => rank)).toEqual([
                GuildRank.D,
            ]);
            expect(first.unlockedRewards.map(({ key }) => key).sort()).toEqual(
                [...GUILD_RANK_PROMOTION_REWARDS[GuildRank.D]].sort(),
            );
            await expect(unlockedKeysOf(userId)).resolves.toEqual(
                [...GUILD_RANK_PROMOTION_REWARDS[GuildRank.D]].sort(),
            );
            await expect(profileOf(userId)).resolves.toEqual(
                expect.objectContaining({
                    rank: GuildRank.D,
                    highestPromotedRank: GuildRank.D,
                }),
            );
            await expect(
                source.query(
                    "SELECT DISTINCT sourceContractId FROM user_guild_reward WHERE profileUserId = ?",
                    [userId],
                ),
            ).resolves.toEqual([{ sourceContractId: "contract-1" }]);

            const second = await transaction((manager) =>
                progression.grantRankPromotionsWithManager(
                    manager,
                    profile,
                    "contract-2",
                ),
            );
            expect(second.promotions).toEqual([]);
            expect(second.unlockedRewards).toEqual([]);
            expect(second.highestPromotedRank).toBe(GuildRank.D);
            await expect(unlockedKeysOf(userId)).resolves.toHaveLength(
                GUILD_RANK_PROMOTION_REWARDS[GuildRank.D].length,
            );
        });

        it("grants every crossed package in rank order on a multi-rank jump", async () => {
            const userId = await createProfile(2_100);
            const profile = await profileOf(userId);

            const result = await transaction((manager) =>
                progression.grantRankPromotionsWithManager(
                    manager,
                    profile,
                    null,
                ),
            );

            expect(result.promotions.map(({ rank }) => rank)).toEqual([
                GuildRank.D,
                GuildRank.C,
                GuildRank.B,
            ]);
            expect(result.highestPromotedRank).toBe(GuildRank.B);
            const expectedKeys = [
                ...GUILD_RANK_PROMOTION_REWARDS[GuildRank.D],
                ...GUILD_RANK_PROMOTION_REWARDS[GuildRank.C],
                ...GUILD_RANK_PROMOTION_REWARDS[GuildRank.B],
            ].sort();
            await expect(unlockedKeysOf(userId)).resolves.toEqual(expectedKeys);

            await source
                .getRepository(GuildProfile)
                .update(
                    { profileUserId: userId },
                    { xp: 4_100, rank: GuildRank.A },
                );
            const refreshed = await profileOf(userId);
            const next = await transaction((manager) =>
                progression.grantRankPromotionsWithManager(
                    manager,
                    refreshed,
                    null,
                ),
            );
            expect(next.promotions.map(({ rank }) => rank)).toEqual([
                GuildRank.A,
            ]);
            await expect(unlockedKeysOf(userId)).resolves.toEqual(
                [
                    ...expectedKeys,
                    ...GUILD_RANK_PROMOTION_REWARDS[GuildRank.A],
                ].sort(),
            );
        });

        it("lazily reconciles a pre-migration member once on first read", async () => {
            const userId = await createProfile(2_200, {
                rank: GuildRank.E,
                highestPromotedRank: GuildRank.E,
            });

            const first =
                await progression.reconcileRankPromotionsIfNeeded(userId);

            expect(first.promotions.map(({ rank }) => rank)).toEqual([
                GuildRank.D,
                GuildRank.C,
                GuildRank.B,
            ]);
            expect(first.highestPromotedRank).toBe(GuildRank.B);
            await expect(profileOf(userId)).resolves.toEqual(
                expect.objectContaining({
                    rank: GuildRank.B,
                    highestPromotedRank: GuildRank.B,
                }),
            );
            const keysAfterFirst = await unlockedKeysOf(userId);
            expect(keysAfterFirst).toHaveLength(6);

            const second =
                await progression.reconcileRankPromotionsIfNeeded(userId);
            expect(second.promotions).toEqual([]);
            expect(second.unlockedRewards).toEqual([]);
            await expect(unlockedKeysOf(userId)).resolves.toEqual(
                keysAfterFirst,
            );

            await expect(
                progression.reconcileRankPromotionsIfNeeded(randomUUID()),
            ).resolves.toEqual({
                highestPromotedRank: GuildRank.E,
                promotions: [],
                unlockedRewards: [],
            });
        });
    });

    describe("Prestige S+ stars", () => {
        it("opens one Relic chest and credits its Seals across 10,000 XP", async () => {
            const userId = await createProfile(10_200, {
                rank: GuildRank.S,
                highestPromotedRank: GuildRank.S,
                prestigeLevel: 0,
            });
            const profile = await profileOf(userId);
            expect(computeGuildPrestige(10_200)).toEqual({
                prestigeLevel: 1,
                prestigeXpIntoCurrent: 200,
                xpToNextPrestige: 2_300,
            });

            const result = await transaction((manager) =>
                progression.grantPrestigeStarsWithManager(
                    manager,
                    profile,
                    "contract-9",
                ),
            );

            expect(result.prestigeLevel).toBe(1);
            expect(result.starsGranted).toBe(1);
            expect(result.chestResults).toHaveLength(1);
            expect(result.chestResults[0]).toEqual(
                expect.objectContaining({
                    chestKind: GuildRewardKind.CHEST_RELIC,
                    unlockedCosmetic: expect.any(Object),
                }),
            );
            expect(result.sealsAwarded).toBe(result.chestResults[0].bonusSeals);
            await expect(profileOf(userId)).resolves.toEqual(
                expect.objectContaining({ prestigeLevel: 1 }),
            );
            const ledger = await ledgerOf(userId);
            expect(ledger).toHaveLength(1);
            expect(ledger[0]).toEqual(
                expect.objectContaining({
                    delta: result.sealsAwarded,
                    balanceAfter: result.sealsAwarded,
                    reason: GuildSealReason.PRESTIGE_STAR,
                }),
            );
            const consumables = await seals.getConsumableBalances(userId);
            const grantedConsumable = result.chestResults[0].grantedConsumable;
            if (grantedConsumable) {
                expect(consumables[grantedConsumable]).toBe(1);
            }

            const again = await transaction((manager) =>
                progression.grantPrestigeStarsWithManager(
                    manager,
                    profile,
                    "contract-10",
                ),
            );
            expect(again.starsGranted).toBe(0);
            expect(again.chestResults).toEqual([]);
            expect(again.prestigeLevel).toBe(1);
            await expect(ledgerOf(userId)).resolves.toHaveLength(1);
        });

        it("grants every star in order on a multi-star jump without duplicates", async () => {
            const userId = await createProfile(12_600, {
                rank: GuildRank.S,
                highestPromotedRank: GuildRank.S,
                prestigeLevel: 0,
            });
            expect(computeGuildPrestige(12_600).prestigeLevel).toBe(2);

            const profile = await profileOf(userId);
            const result = await transaction((manager) =>
                progression.grantPrestigeStarsWithManager(
                    manager,
                    profile,
                    "contract-11",
                ),
            );

            expect(result.starsGranted).toBe(2);
            expect(result.prestigeLevel).toBe(2);
            expect(result.chestResults).toHaveLength(2);
            expect(
                result.chestResults.every(
                    ({ chestKind }) =>
                        chestKind === GuildRewardKind.CHEST_RELIC,
                ),
            ).toBe(true);
            expect(result.sealsAwarded).toBe(
                result.chestResults.reduce(
                    (total, chest) => total + chest.bonusSeals,
                    0,
                ),
            );
            await expect(profileOf(userId)).resolves.toEqual(
                expect.objectContaining({ prestigeLevel: 2 }),
            );

            const again = await transaction((manager) =>
                progression.grantPrestigeStarsWithManager(
                    manager,
                    profile,
                    "contract-12",
                ),
            );
            expect(again.starsGranted).toBe(0);
            expect(again.chestResults).toEqual([]);
            await expect(ledgerOf(userId)).resolves.toHaveLength(2);
        });

        it("does not grant a star below 7,500 XP", async () => {
            const userId = await createProfile(7_499, {
                rank: GuildRank.A,
                highestPromotedRank: GuildRank.S,
                prestigeLevel: 0,
            });

            const profile = await profileOf(userId);
            const result = await transaction((manager) =>
                progression.grantPrestigeStarsWithManager(
                    manager,
                    profile,
                    null,
                ),
            );

            expect(result).toEqual({
                prestigeLevel: 0,
                starsGranted: 0,
                chestResults: [],
                sealsAwarded: 0,
            });
            await expect(ledgerOf(userId)).resolves.toEqual([]);
        });

        it("rolls Prestige chests and Seals back with the caller's transaction", async () => {
            const userId = await createProfile(10_200, {
                rank: GuildRank.S,
                highestPromotedRank: GuildRank.S,
                prestigeLevel: 0,
            });

            await expect(
                transaction(async (manager) => {
                    await progression.grantPrestigeStarsWithManager(
                        manager,
                        await profileOf(userId),
                        "contract-13",
                    );
                    throw new Error("rollback");
                }),
            ).rejects.toThrow("rollback");

            await expect(profileOf(userId)).resolves.toEqual(
                expect.objectContaining({ prestigeLevel: 0 }),
            );
            await expect(ledgerOf(userId)).resolves.toEqual([]);
            await expect(
                source
                    .getRepository(GuildReward)
                    .countBy({ inChestPool: true, isActive: true }),
            ).resolves.toBeGreaterThan(0);
        });
    });
});
