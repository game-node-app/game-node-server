import "reflect-metadata";
import { createHash, randomUUID } from "node:crypto";
import { INestApplication, ForbiddenException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { DataSource, In } from "typeorm";
import { createAwardsTestDatabase } from "../../test/awards/awards-test-database";
import { achievementFixtures } from "../../test/achievements/achievement-fixtures";
import { AchievementsProgressService } from "../achievements/achievements-progress.service";
import { ObtainedAchievement } from "../achievements/entities/obtained-achievement.entity";
import { LevelService } from "../level/level.service";
import { UserLevel } from "../level/entities/user-level.entity";
import { AuthService } from "../auth/auth.service";
import { LibraryAccessService } from "../libraries/library-access.service";
import { LibraryVisibility } from "../libraries/library-visibility.constants";
import { ProfileController } from "../profile/profile.controller";
import { ProfileService } from "../profile/profile.service";
import { ProfileVideoService } from "../profile/profile-video/profile-video.service";
import { ProfileSupporterPreferences } from "../profile/entities/profile-supporter-preferences.entity";
import { ProfileVideo } from "../profile/entities/profile-video.entity";
import { Profile } from "../profile/entities/profile.entity";
import { SupporterPreferencesService } from "../profile/supporter-preferences/supporter-preferences.service";
import { BillingService } from "../billing/billing.service";
import { GuildRewardsService } from "./guild-rewards.service";
import { GuildSealsService } from "./guild-seals.service";
import type { UpdateGuildCosmeticsDto } from "./dto/guild-rewards.dto";
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
} from "./guild.constants";
import { GuildConsumableInventory } from "./entities/guild-consumable-inventory.entity";
import { GuildProfile } from "./entities/guild-profile.entity";
import { GuildReward } from "./entities/guild-reward.entity";
import { GuildSealLedger } from "./entities/guild-seal-ledger.entity";
import { UserGuildReward } from "./entities/user-guild-reward.entity";

const EMPTY_FULFILLMENT = {
    bonusXp: 0,
    bonusSeals: 0,
    unlockedRewards: [],
    chestResult: null,
    pendingBadgeActivity: null,
};

const COSMETIC_KINDS = [
    GuildRewardKind.TITLE,
    GuildRewardKind.AVATAR_FRAME,
    GuildRewardKind.LICENSE_THEME,
    GuildRewardKind.STAMP_STYLE,
    GuildRewardKind.TAVERN_DECOR,
];

const deterministicId = (namespace: number, index: number) =>
    `${namespace.toString(16).padStart(4, "0")}${index
        .toString(16)
        .padStart(4, "0")}-0000-4000-8000-000000000000`;

describe("GuildRewardsService (integration)", () => {
    jest.setTimeout(120000);

    const database = `guild_test_rewards_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    let source: DataSource;
    let db: Awaited<ReturnType<typeof createAwardsTestDatabase>>;
    let service: GuildRewardsService;
    let fixtures: ReturnType<typeof achievementFixtures>;
    let app: INestApplication;
    const activities = { register: jest.fn() };
    const videoService = {
        isSupporter: jest.fn(async () => false),
        findForProfileRead: jest.fn(async () => ({
            avatarVideo: null,
            bannerVideo: null,
        })),
    };
    const preferencesService = { findOrDefaults: jest.fn() };
    const libraryAccessService = {
        resolve: jest.fn(async () => ({
            audience: "everyone",
            libraryVisibility: LibraryVisibility.Public,
            canViewLibrary: true,
            visibleEntryLevels: [LibraryVisibility.Public],
        })),
    };

    beforeAll(async () => {
        db = await createAwardsTestDatabase(database);
        source = db.source;
        fixtures = achievementFixtures(source);
        const levelService = new LevelService(source.getRepository(UserLevel));
        const achievements = new AchievementsProgressService(
            source,
            levelService,
            activities as any,
        );
        service = new GuildRewardsService(
            source,
            achievements,
            new GuildSealsService(source),
        );

        const module = await Test.createTestingModule({
            controllers: [ProfileController],
            providers: [
                {
                    provide: AuthService,
                    useValue: { getSession: jest.fn(async () => null) },
                },
                {
                    provide: ProfileService,
                    useValue: new ProfileService(
                        source.getRepository(Profile),
                        source.getRepository(ProfileVideo),
                        {} as any,
                        { delete: jest.fn() } as any,
                    ),
                },
                { provide: ProfileVideoService, useValue: videoService },
                {
                    provide: SupporterPreferencesService,
                    useValue: preferencesService,
                },
                {
                    provide: LibraryAccessService,
                    useValue: libraryAccessService,
                },
                {
                    provide: BillingService,
                    useValue: {
                        findSupporterUserIdsIn: jest.fn(
                            async () => new Set<string>(),
                        ),
                    },
                },
            ],
        }).compile();
        app = module.createNestApplication();
        await app.init();
    });

    afterAll(async () => {
        await app?.close();
        await db?.destroy();
    });

    beforeEach(() => {
        activities.register.mockReset();
    });

    const createProfile = async (
        overrides: Partial<Profile> = {},
        userId: string = randomUUID(),
    ) => {
        await source.getRepository(Profile).insert({
            userId,
            username: `g${userId.slice(0, 18)}`,
            ...overrides,
        });
        return userId;
    };

    const cosmeticPool = (rarities: readonly GuildRewardRarity[]) =>
        source.getRepository(GuildReward).find({
            where: {
                inChestPool: true,
                isActive: true,
                kind: In(COSMETIC_KINDS),
                rarity: In([...rarities]),
            },
        });

    /** Same seeded order and rarity preference the service uses. */
    const expectedChestPick = async (
        userId: string,
        sourceId: string,
        chestKind: GuildChestKind,
        ownedIds: Set<string>,
    ) => {
        const tier = resolveGuildChestTier(chestKind);
        const pool = await cosmeticPool([
            ...tier.poolRarities,
            ...tier.fallbackRarities,
        ]);
        const ordered = seededOrder(
            createHash("sha256").update(`${userId}:${sourceId}`).digest(),
            pool,
            (cosmetic) => cosmetic.id,
        );
        return (
            ordered.find(
                (cosmetic) =>
                    tier.poolRarities.includes(cosmetic.rarity) &&
                    !ownedIds.has(cosmetic.id),
            ) ??
            ordered.find(
                (cosmetic) =>
                    tier.fallbackRarities.includes(cosmetic.rarity) &&
                    !ownedIds.has(cosmetic.id),
            ) ??
            null
        );
    };

    const chestSeed = (userId: string, sourceId: string) =>
        createHash("sha256").update(`${userId}:${sourceId}`).digest();

    const expectedConsumable = (
        userId: string,
        sourceId: string,
        chestKind: GuildChestKind,
    ): GuildConsumableKey | null => {
        const tier = resolveGuildChestTier(chestKind);
        if (tier.consumableKeys.length === 0) return null;
        const roll =
            createHash("sha256")
                .update(chestSeed(userId, sourceId))
                .update(`${tier.kind}:consumable`)
                .digest()[0] / 256;
        if (roll >= tier.consumableDropChance) return null;
        return seededOrder(
            createHash("sha256")
                .update(chestSeed(userId, sourceId))
                .update(`${tier.kind}:key`)
                .digest(),
            tier.consumableKeys,
            (key) => key,
        )[0];
    };

    const sourceIdForGoldRoll = (userId: string, belowChance: boolean) => {
        for (let index = 0; ; index++) {
            const sourceId = deterministicId(9, index);
            const drops =
                expectedConsumable(
                    userId,
                    sourceId,
                    GuildRewardKind.CHEST_GOLD,
                ) !== null;
            if (drops === belowChance) return sourceId;
        }
    };

    const makeReward = async (overrides: Partial<GuildReward>) => {
        const id = randomUUID();
        return source.getRepository(GuildReward).save({
            id,
            key: `reward_${id.slice(0, 8)}`,
            kind: GuildRewardKind.TITLE,
            achievementId: null,
            inChestPool: false,
            chestBonusXp: 0,
            chestBonusSeals: 0,
            rarity: GuildRewardRarity.COMMON,
            consumableKey: null,
            isActive: true,
            ...overrides,
        });
    };

    const makePoolCosmetic = (rarity: GuildRewardRarity) =>
        makeReward({
            kind: GuildRewardKind.TITLE,
            inChestPool: true,
            rarity,
        });

    const unlock = (userId: string, reward: GuildReward) =>
        source.getRepository(UserGuildReward).insert({
            profileUserId: userId,
            rewardId: reward.id,
            sourceContractId: null,
            unlockedAt: new Date(),
        });

    const unlockKeysOf = async (userId: string) =>
        (
            await source.query(
                "SELECT gr.`key` AS `key` FROM user_guild_reward ugr JOIN guild_reward gr ON gr.id = ugr.rewardId WHERE ugr.profileUserId = ? ORDER BY gr.`key`",
                [userId],
            )
        ).map((row: { key: string }) => row.key);

    const equippedOf = (userId: string) =>
        source
            .getRepository(Profile)
            .findOneByOrFail({ userId })
            .then(({ guildTitleKey, guildFrameKey }) => ({
                guildTitleKey,
                guildFrameKey,
            }));

    const guildProfileOf = (userId: string) =>
        source
            .getRepository(GuildProfile)
            .findOneByOrFail({ profileUserId: userId });

    const sealsBalanceOf = (userId: string) =>
        guildProfileOf(userId).then((profile) => profile.sealsBalance);

    const descriptorOf = (reward: GuildReward) => ({
        id: reward.id,
        key: reward.key,
        achievementId: reward.achievementId,
        kind: reward.kind,
        inChestPool: reward.inChestPool,
        chestBonusXp: reward.chestBonusXp,
        chestBonusSeals: reward.chestBonusSeals,
        rarity: reward.rarity,
        consumableKey: reward.consumableKey,
    });

    const fulfill = (
        userId: string,
        rewardId: string | null,
        contractId: string = randomUUID(),
        options: { upgradeChestTier?: boolean } = {},
    ) =>
        source.transaction((manager) =>
            service.fulfillContractRewardWithManager(
                manager,
                userId,
                contractId,
                rewardId,
                new Date(),
                options,
            ),
        );

    const rejectionOf = async (promise: Promise<unknown>) =>
        promise.then(
            () => null,
            (error) => error,
        );

    describe("getUserRewards", () => {
        it("returns every unlocked kind plus consumables, Seals and all equipped slots", async () => {
            const user = await createProfile({
                guildTitleKey: "title_listed",
                guildFrameKey: "frame_listed",
            });
            await source.getRepository(GuildProfile).insert({
                profileUserId: user,
                sealsBalance: 75,
                equippedLicenseThemeKey: "license_obsidian_ledger",
                equippedStampStyleKey: "stamp_gold_seal",
                equippedDecorKeys: [
                    "decor_sleeping_cat",
                    "decor_tavern_lantern",
                ],
                showcaseBadgeIds: ["guild-archaeologist"],
            });
            const rewards = await Promise.all([
                makeReward({
                    kind: GuildRewardKind.TITLE,
                    key: "title_listed",
                }),
                makeReward({
                    kind: GuildRewardKind.AVATAR_FRAME,
                    key: "frame_listed",
                }),
                makeReward({
                    kind: GuildRewardKind.LICENSE_THEME,
                    key: "license_obsidian_ledger",
                }),
                makeReward({
                    kind: GuildRewardKind.STAMP_STYLE,
                    key: "stamp_gold_seal",
                }),
                makeReward({
                    kind: GuildRewardKind.TAVERN_DECOR,
                    key: "decor_sleeping_cat",
                }),
                makeReward({
                    kind: GuildRewardKind.CONSUMABLE,
                    key: "consumable_hourglass",
                    consumableKey: GuildConsumableKey.HOURGLASS,
                }),
            ]);
            for (const reward of rewards) {
                await unlock(user, reward);
            }
            await source.getRepository(GuildConsumableInventory).insert({
                profileUserId: user,
                consumableKey: GuildConsumableKey.HOURGLASS,
                quantity: 2,
            });

            const result = await service.getUserRewards(user);

            expect(
                result.unlockedRewards.map((row) => row.reward.key).sort(),
            ).toEqual(rewards.map((reward) => reward.key).sort());
            expect(result.equippedTitleKey).toBe("title_listed");
            expect(result.equippedFrameKey).toBe("frame_listed");
            expect(result.equippedLicenseThemeKey).toBe(
                "license_obsidian_ledger",
            );
            expect(result.equippedStampStyleKey).toBe("stamp_gold_seal");
            expect(result.equippedDecorKeys).toEqual([
                "decor_sleeping_cat",
                "decor_tavern_lantern",
            ]);
            expect(result.showcaseBadgeIds).toEqual(["guild-archaeologist"]);
            expect(result.sealsBalance).toBe(75);
            expect(result.consumables).toEqual({
                [GuildConsumableKey.HOURGLASS]: 2,
                [GuildConsumableKey.REROLL_CHARTER]: 0,
                [GuildConsumableKey.EXTRA_SLOT_PERMIT]: 0,
            });

            await expect(service.getUserRewards(randomUUID())).resolves.toEqual(
                {
                    unlockedRewards: [],
                    equippedTitleKey: null,
                    equippedFrameKey: null,
                    equippedLicenseThemeKey: null,
                    equippedStampStyleKey: null,
                    equippedDecorKeys: [],
                    showcaseBadgeIds: [],
                    sealsBalance: 0,
                    consumables: {
                        [GuildConsumableKey.HOURGLASS]: 0,
                        [GuildConsumableKey.REROLL_CHARTER]: 0,
                        [GuildConsumableKey.EXTRA_SLOT_PERMIT]: 0,
                    },
                },
            );
        });
    });

    describe("updateCosmetics", () => {
        it("equips every Guild-only slot on guild_profile", async () => {
            const user = await createProfile();
            const title = await makeReward({
                kind: GuildRewardKind.TITLE,
            });
            const frame = await makeReward({
                kind: GuildRewardKind.AVATAR_FRAME,
            });
            const theme = await makeReward({
                kind: GuildRewardKind.LICENSE_THEME,
            });
            const stamp = await makeReward({
                kind: GuildRewardKind.STAMP_STYLE,
            });
            const cats = await makeReward({
                kind: GuildRewardKind.TAVERN_DECOR,
            });
            const lantern = await makeReward({
                kind: GuildRewardKind.TAVERN_DECOR,
            });
            const definition = await fixtures.definition("manual", {}, [
                [1, 0],
            ]);
            await source.getRepository(ObtainedAchievement).insert({
                achievementId: definition.id,
                profileUserId: user,
                tier: 1,
            });
            for (const reward of [title, frame, theme, stamp, cats, lantern]) {
                await unlock(user, reward);
            }
            await source.getRepository(ProfileSupporterPreferences).insert({
                profileUserId: user,
                titleKey: "founder",
                accentColor: "#FF8800",
            });

            const dto = {
                guildTitleKey: title.key,
                guildFrameKey: frame.key,
                equippedLicenseThemeKey: theme.key,
                equippedStampStyleKey: stamp.key,
                equippedDecorKeys: [cats.key, lantern.key],
                showcaseBadgeIds: [definition.id],
            };
            await expect(service.updateCosmetics(user, dto)).resolves.toEqual(
                dto,
            );

            await expect(guildProfileOf(user)).resolves.toEqual(
                expect.objectContaining({
                    equippedLicenseThemeKey: theme.key,
                    equippedStampStyleKey: stamp.key,
                    equippedDecorKeys: [cats.key, lantern.key],
                    showcaseBadgeIds: [definition.id],
                }),
            );
            await expect(equippedOf(user)).resolves.toEqual({
                guildTitleKey: title.key,
                guildFrameKey: frame.key,
            });

            // Supporter perks live in their own table and are never touched here.
            await expect(
                source
                    .getRepository(ProfileSupporterPreferences)
                    .findOneByOrFail({ profileUserId: user }),
            ).resolves.toEqual(
                expect.objectContaining({
                    titleKey: "founder",
                    accentColor: "#FF8800",
                }),
            );
        });

        it("unequips arrays and slots with null while keeping omitted ones", async () => {
            const user = await createProfile();
            const theme = await makeReward({
                kind: GuildRewardKind.LICENSE_THEME,
                key: "license_kept",
            });
            const decor = await makeReward({
                kind: GuildRewardKind.TAVERN_DECOR,
                key: "decor_kept",
            });
            await unlock(user, theme);
            await unlock(user, decor);
            await service.updateCosmetics(user, {
                equippedLicenseThemeKey: theme.key,
                equippedDecorKeys: [decor.key],
            });

            await expect(
                service.updateCosmetics(user, {
                    equippedDecorKeys: null,
                    showcaseBadgeIds: null,
                }),
            ).resolves.toEqual({
                guildTitleKey: null,
                guildFrameKey: null,
                equippedLicenseThemeKey: theme.key,
                equippedStampStyleKey: null,
                equippedDecorKeys: [],
                showcaseBadgeIds: [],
            });
            await expect(guildProfileOf(user)).resolves.toEqual(
                expect.objectContaining({
                    equippedLicenseThemeKey: theme.key,
                    equippedDecorKeys: null,
                    showcaseBadgeIds: null,
                }),
            );

            await expect(service.updateCosmetics(user, {})).resolves.toEqual({
                guildTitleKey: null,
                guildFrameKey: null,
                equippedLicenseThemeKey: theme.key,
                equippedStampStyleKey: null,
                equippedDecorKeys: [],
                showcaseBadgeIds: [],
            });
        });

        it("rejects unowned or wrong-kind keys without changing any slot", async () => {
            const user = await createProfile({
                guildTitleKey: "title_vested",
                guildFrameKey: "frame_vested",
            });
            await source.getRepository(GuildProfile).insert({
                profileUserId: user,
                equippedLicenseThemeKey: "license_vested",
                equippedDecorKeys: ["decor_vested"],
            });
            const title = await makeReward({
                kind: GuildRewardKind.TITLE,
                key: "title_vested",
            });
            const frame = await makeReward({
                kind: GuildRewardKind.AVATAR_FRAME,
                key: "frame_vested",
            });
            const theme = await makeReward({
                kind: GuildRewardKind.LICENSE_THEME,
                key: "license_vested",
            });
            const decor = await makeReward({
                kind: GuildRewardKind.TAVERN_DECOR,
                key: "decor_vested",
            });
            const unownedTheme = await makeReward({
                kind: GuildRewardKind.LICENSE_THEME,
                key: "license_retired",
            });
            const unownedDecor = await makeReward({
                kind: GuildRewardKind.TAVERN_DECOR,
                key: "decor_retired",
            });
            for (const reward of [title, frame, theme, decor]) {
                await unlock(user, reward);
            }

            const cases: Array<[UpdateGuildCosmeticsDto, RegExp]> = [
                [{ guildTitleKey: frame.key }, /cosmetic/],
                [{ equippedLicenseThemeKey: title.key }, /cosmetic/],
                [{ equippedLicenseThemeKey: unownedTheme.key }, /cosmetic/],
                [
                    { equippedDecorKeys: [decor.key, unownedDecor.key] },
                    /cosmetic/,
                ],
                [{ showcaseBadgeIds: ["unowned-achievement"] }, /badge/],
            ];
            for (const [dto, message] of cases) {
                const rejection = await rejectionOf(
                    service.updateCosmetics(user, dto),
                );
                expect(rejection).toBeInstanceOf(ForbiddenException);
                expect(rejection.getStatus()).toBe(403);
                expect(rejection.getResponse()).toEqual({
                    message: expect.stringMatching(message),
                    code: "guild_cosmetic_not_owned",
                });
            }

            await expect(equippedOf(user)).resolves.toEqual({
                guildTitleKey: "title_vested",
                guildFrameKey: "frame_vested",
            });
            await expect(guildProfileOf(user)).resolves.toEqual(
                expect.objectContaining({
                    equippedLicenseThemeKey: "license_vested",
                    equippedDecorKeys: ["decor_vested"],
                }),
            );
        });

        it("rejects oversized or duplicated arrays with 400", async () => {
            const user = await createProfile();
            const tooManyDecor = Array.from(
                { length: 5 },
                (_, index) => `decor_${index}`,
            );
            const tooManyBadges = Array.from(
                { length: 4 },
                (_, index) => `badge-${index}`,
            );

            for (const dto of [
                { equippedDecorKeys: tooManyDecor },
                { showcaseBadgeIds: tooManyBadges },
                { equippedDecorKeys: ["decor_same", "decor_same"] },
                { showcaseBadgeIds: ["badge_same", "badge_same"] },
            ] as UpdateGuildCosmeticsDto[]) {
                const rejection = await rejectionOf(
                    service.updateCosmetics(user, dto),
                );
                expect(rejection.getStatus()).toBe(400);
                expect(rejection.getResponse()).toEqual({
                    message: expect.any(String),
                    code: "guild_cosmetic_limit_exceeded",
                });
            }
        });
    });

    describe("fulfillContractRewardWithManager", () => {
        it("grants a badge once and pays XP + Seals when it is already owned", async () => {
            const user = await createProfile();
            const definition = await fixtures.definition("manual", {}, [
                [1, 0],
            ]);
            const reward = await makeReward({
                kind: GuildRewardKind.BADGE,
                achievementId: definition.id,
            });

            const first = await fulfill(user, reward.id);

            expect(first.bonusXp).toBe(0);
            expect(first.bonusSeals).toBe(0);
            expect(first.chestResult).toBeNull();
            expect(first.unlockedRewards).toEqual([descriptorOf(reward)]);
            expect(first.pendingBadgeActivity).toEqual({
                obtainedAchievementId: expect.any(Number),
                tier: 1,
            });
            expect(
                await source.query(
                    "SELECT tier FROM obtained_achievement WHERE profileUserId = ? AND achievementId = ?",
                    [user, definition.id],
                ),
            ).toEqual([{ tier: 1 }]);
            expect(activities.register).not.toHaveBeenCalled();

            const second = await fulfill(user, reward.id);

            expect(second.unlockedRewards).toEqual([]);
            expect(second.pendingBadgeActivity).toBeNull();
            expect(second.bonusXp).toBe(DUPLICATE_COSMETIC_BONUS_XP);
            expect(second.bonusSeals).toBe(DUPLICATE_BADGE_BONUS_SEALS);
            expect(
                await source.query(
                    "SELECT tier FROM obtained_achievement WHERE profileUserId = ? AND achievementId = ?",
                    [user, definition.id],
                ),
            ).toEqual([{ tier: 1 }]);
            await expect(sealsBalanceOf(user)).resolves.toBe(
                DUPLICATE_BADGE_BONUS_SEALS,
            );
            await expect(
                source.getRepository(GuildSealLedger).find({
                    where: { profileUserId: user },
                }),
            ).resolves.toEqual([
                expect.objectContaining({
                    delta: DUPLICATE_BADGE_BONUS_SEALS,
                    balanceAfter: DUPLICATE_BADGE_BONUS_SEALS,
                    reason: GuildSealReason.DUPLICATE_FALLBACK,
                    referenceId: expect.any(String),
                }),
            ]);
        });

        it("unlocks every permanent cosmetic kind once and pays +50 XP on duplicates", async () => {
            const user = await createProfile();

            for (const kind of COSMETIC_KINDS) {
                const reward = await makeReward({ kind });
                const contractId = randomUUID();

                const first = await fulfill(user, reward.id, contractId);

                expect(first.bonusXp).toBe(0);
                expect(first.bonusSeals).toBe(0);
                expect(first.unlockedRewards).toEqual([descriptorOf(reward)]);
                await expect(
                    source.getRepository(UserGuildReward).findOneByOrFail({
                        profileUserId: user,
                        rewardId: reward.id,
                    }),
                ).resolves.toEqual(
                    expect.objectContaining({
                        sourceContractId: contractId,
                    }),
                );

                const duplicate = await fulfill(user, reward.id);

                expect(duplicate.bonusXp).toBe(DUPLICATE_COSMETIC_BONUS_XP);
                expect(duplicate.unlockedRewards).toEqual([]);
                await expect(
                    source
                        .getRepository(UserGuildReward)
                        .countBy({ profileUserId: user, rewardId: reward.id }),
                ).resolves.toBe(1);
            }
        });

        it("grants a consumable reward into the inventory", async () => {
            const user = await createProfile();
            const reward = await makeReward({
                kind: GuildRewardKind.CONSUMABLE,
                consumableKey: GuildConsumableKey.HOURGLASS,
            });

            const result = await fulfill(user, reward.id);

            expect(result.unlockedRewards).toEqual([descriptorOf(reward)]);
            await expect(
                source.getRepository(GuildConsumableInventory).findOneByOrFail({
                    profileUserId: user,
                    consumableKey: GuildConsumableKey.HOURGLASS,
                }),
            ).resolves.toEqual(expect.objectContaining({ quantity: 1 }));
        });

        it("opens every chest tier with its own XP, Seals and rarity band", async () => {
            const cases: Array<{
                kind: GuildChestKind;
                resolved: GuildChestTierKey;
                rarity: GuildRewardRarity;
            }> = [
                {
                    kind: GuildRewardKind.CHEST_BRONZE,
                    resolved: GuildRewardKind.CHEST_BRONZE,
                    rarity: GuildRewardRarity.COMMON,
                },
                {
                    kind: GuildRewardKind.CHEST_SILVER,
                    resolved: GuildRewardKind.CHEST_SILVER,
                    rarity: GuildRewardRarity.UNCOMMON,
                },
                {
                    kind: GuildRewardKind.WEEKLY_CHEST,
                    resolved: GuildRewardKind.CHEST_SILVER,
                    rarity: GuildRewardRarity.UNCOMMON,
                },
                {
                    kind: GuildRewardKind.CHEST_GOLD,
                    resolved: GuildRewardKind.CHEST_GOLD,
                    rarity: GuildRewardRarity.RARE,
                },
                {
                    kind: GuildRewardKind.CHEST_RELIC,
                    resolved: GuildRewardKind.CHEST_RELIC,
                    rarity: GuildRewardRarity.LEGENDARY,
                },
            ];

            for (const { kind, resolved, rarity } of cases) {
                const user = await createProfile();
                const chest = await makeReward({ kind });
                await makePoolCosmetic(rarity);
                const contractId = randomUUID();
                const tier = resolveGuildChestTier(resolved);

                const result = await fulfill(user, chest.id, contractId);
                const expected = await expectedChestPick(
                    user,
                    contractId,
                    kind,
                    new Set(),
                );
                expect(expected).not.toBeNull();
                expect(result.chestResult).toEqual({
                    chestKind: resolved,
                    bonusXp: tier.bonusXp,
                    bonusSeals: tier.bonusSeals,
                    unlockedCosmetic: descriptorOf(expected!),
                    grantedConsumable: expectedConsumable(
                        user,
                        contractId,
                        kind,
                    ),
                });
                expect(result.bonusXp).toBe(tier.bonusXp);
                expect(result.bonusSeals).toBe(tier.bonusSeals);
                expect(result.unlockedRewards).toEqual([
                    descriptorOf(expected!),
                ]);
                await expect(sealsBalanceOf(user)).resolves.toBe(
                    tier.bonusSeals,
                );
            }
        });

        it("rolls a deterministic Gold consumable drop and always drops on Relic", async () => {
            const goldUser = await createProfile();
            const goldChest = await makeReward({
                kind: GuildRewardKind.CHEST_GOLD,
            });
            await makePoolCosmetic(GuildRewardRarity.RARE);
            await makePoolCosmetic(GuildRewardRarity.RARE);

            const dropSource = sourceIdForGoldRoll(goldUser, true);
            const withDrop = await fulfill(goldUser, goldChest.id, dropSource);
            const expectedDrop = expectedConsumable(
                goldUser,
                dropSource,
                GuildRewardKind.CHEST_GOLD,
            );
            expect(expectedDrop).not.toBeNull();
            expect(withDrop.chestResult?.grantedConsumable).toBe(expectedDrop);
            await expect(
                source.getRepository(GuildConsumableInventory).findOneByOrFail({
                    profileUserId: goldUser,
                    consumableKey: expectedDrop!,
                }),
            ).resolves.toEqual(expect.objectContaining({ quantity: 1 }));

            const noDropSource = sourceIdForGoldRoll(goldUser, false);
            const withoutDrop = await fulfill(
                goldUser,
                goldChest.id,
                noDropSource,
            );
            expect(withoutDrop.chestResult?.grantedConsumable).toBeNull();

            const relicUser = await createProfile();
            const relicChest = await makeReward({
                kind: GuildRewardKind.CHEST_RELIC,
            });
            await makePoolCosmetic(GuildRewardRarity.LEGENDARY);
            const relic = await fulfill(relicUser, relicChest.id);
            expect(relic.chestResult?.grantedConsumable).toEqual(
                expect.any(String),
            );
            await expect(
                source.getRepository(GuildConsumableInventory).find({
                    where: { profileUserId: relicUser },
                }),
            ).resolves.toEqual([
                expect.objectContaining({
                    consumableKey: relic.chestResult?.grantedConsumable,
                    quantity: 1,
                }),
            ]);
        });

        it("upgrades a chest one tier for a completed bonus objective", async () => {
            const user = await createProfile();
            const chest = await makeReward({
                kind: GuildRewardKind.CHEST_BRONZE,
            });
            await makePoolCosmetic(GuildRewardRarity.UNCOMMON);
            const contractId = randomUUID();
            const expected = await expectedChestPick(
                user,
                contractId,
                GuildRewardKind.CHEST_SILVER,
                new Set(),
            );

            const result = await fulfill(user, chest.id, contractId, {
                upgradeChestTier: true,
            });

            expect(result.chestResult).toEqual({
                chestKind: GuildRewardKind.CHEST_SILVER,
                bonusXp: 75,
                bonusSeals: 30,
                unlockedCosmetic: descriptorOf(expected!),
                grantedConsumable: null,
            });
        });

        it("converts an exhausted tier pool into extra XP and Seals", async () => {
            const cases: Array<{
                kind: GuildChestKind;
                resolved: GuildChestTierKey;
                rarity: GuildRewardRarity;
            }> = [
                {
                    kind: GuildRewardKind.CHEST_BRONZE,
                    resolved: GuildRewardKind.CHEST_BRONZE,
                    rarity: GuildRewardRarity.COMMON,
                },
                {
                    kind: GuildRewardKind.CHEST_SILVER,
                    resolved: GuildRewardKind.CHEST_SILVER,
                    rarity: GuildRewardRarity.UNCOMMON,
                },
                {
                    kind: GuildRewardKind.CHEST_GOLD,
                    resolved: GuildRewardKind.CHEST_GOLD,
                    rarity: GuildRewardRarity.RARE,
                },
                {
                    kind: GuildRewardKind.CHEST_RELIC,
                    resolved: GuildRewardKind.CHEST_RELIC,
                    rarity: GuildRewardRarity.LEGENDARY,
                },
            ];

            for (const { kind, resolved, rarity } of cases) {
                const user = await createProfile();
                const chest = await makeReward({ kind });
                await makePoolCosmetic(rarity);
                const tier = resolveGuildChestTier(resolved);
                const pool = await cosmeticPool([
                    ...tier.poolRarities,
                    ...tier.fallbackRarities,
                ]);
                for (const cosmetic of pool) {
                    await unlock(user, cosmetic);
                }

                const result = await fulfill(user, chest.id);

                expect(result.chestResult?.unlockedCosmetic).toBeNull();
                expect(result.chestResult?.bonusXp).toBe(
                    tier.bonusXp + tier.exhaustedBonusXp,
                );
                expect(result.chestResult?.bonusSeals).toBe(
                    tier.bonusSeals + tier.exhaustedBonusSeals,
                );
                expect(result.unlockedRewards).toEqual([]);
                await expect(sealsBalanceOf(user)).resolves.toBe(
                    tier.bonusSeals + tier.exhaustedBonusSeals,
                );
            }
        });

        it("spreads chest cosmetics across users and contracts", async () => {
            const chest = await makeReward({
                kind: GuildRewardKind.CHEST_SILVER,
            });
            for (let index = 0; index < 6; index++) {
                await makePoolCosmetic(GuildRewardRarity.UNCOMMON);
            }

            const picks = new Set<string>();
            for (let index = 0; index < 5; index++) {
                const user = await createProfile({}, deterministicId(1, index));
                const contractId = deterministicId(2, index);
                const result = await fulfill(user, chest.id, contractId);
                const expected = await expectedChestPick(
                    user,
                    contractId,
                    GuildRewardKind.CHEST_SILVER,
                    new Set(),
                );
                expect(result.chestResult?.unlockedCosmetic).toEqual(
                    descriptorOf(expected!),
                );
                picks.add(result.chestResult!.unlockedCosmetic!.key);
            }
            expect(picks.size).toBeGreaterThan(1);

            const user = await createProfile({}, deterministicId(3, 0));
            const first = await fulfill(user, chest.id, deterministicId(4, 0));
            const second = await fulfill(user, chest.id, deterministicId(4, 1));
            expect(first.chestResult?.unlockedCosmetic?.key).not.toBe(
                second.chestResult?.unlockedCosmetic?.key,
            );
        });

        it("returns an empty fulfillment for a null or unknown reward", async () => {
            const user = await createProfile();

            await expect(fulfill(user, null)).resolves.toEqual(
                EMPTY_FULFILLMENT,
            );
            await expect(fulfill(user, randomUUID())).resolves.toEqual(
                EMPTY_FULFILLMENT,
            );
        });

        it("rolls cosmetic unlocks and Seal credits back with the caller's transaction", async () => {
            const user = await createProfile();
            const reward = await makeReward({ kind: GuildRewardKind.TITLE });
            const chest = await makeReward({
                kind: GuildRewardKind.CHEST_BRONZE,
            });
            await makePoolCosmetic(GuildRewardRarity.COMMON);

            for (const rewardId of [reward.id, chest.id]) {
                await expect(
                    source.transaction(async (manager) => {
                        await service.fulfillContractRewardWithManager(
                            manager,
                            user,
                            randomUUID(),
                            rewardId,
                        );
                        throw new Error("rollback");
                    }),
                ).rejects.toThrow("rollback");
            }

            await expect(
                source
                    .getRepository(UserGuildReward)
                    .countBy({ profileUserId: user }),
            ).resolves.toBe(0);
            await expect(
                source
                    .getRepository(GuildSealLedger)
                    .countBy({ profileUserId: user }),
            ).resolves.toBe(0);
            await expect(
                source
                    .getRepository(GuildProfile)
                    .findOneBy({ profileUserId: user }),
            ).resolves.toBeNull();
        });
    });

    describe("profile reads", () => {
        it("exposes Guild cosmetics on GET /profile/:id with the same SQL statement count", async () => {
            const equipped = await createProfile({
                guildTitleKey: "title_chronist",
                guildFrameKey: "frame_lantern_glow",
            });
            const plain = await createProfile();
            await source.getRepository(GuildProfile).insert({
                profileUserId: equipped,
                sealsBalance: 75,
                equippedLicenseThemeKey: "license_obsidian_ledger",
                equippedStampStyleKey: "stamp_gold_seal",
                equippedDecorKeys: ["decor_sleeping_cat"],
                showcaseBadgeIds: ["guild-archaeologist"],
            });

            const log = jest.spyOn(source.logger, "logQuery");
            try {
                const response = await request(app.getHttpServer()).get(
                    `/profile/${equipped}`,
                );
                const queries = log.mock.calls.map(([sql]) => sql);

                expect(response.status).toBe(200);
                expect(response.body.guildTitleKey).toBe("title_chronist");
                expect(response.body.guildFrameKey).toBe("frame_lantern_glow");
                // The existing relation read emits two statements; the guild columns ride along.
                expect(queries).toHaveLength(2);
                expect(
                    queries.some((sql) => sql.includes("`guildTitleKey`")),
                ).toBe(true);
                expect(queries.some((sql) => /`guild_/.test(sql))).toBe(false);

                log.mockClear();
                const plainResponse = await request(app.getHttpServer()).get(
                    `/profile/${plain}`,
                );

                expect(plainResponse.status).toBe(200);
                expect(plainResponse.body.guildTitleKey).toBeNull();
                expect(plainResponse.body.guildFrameKey).toBeNull();
                // Same statement count with and without Guild-only cosmetics: zero extra SQL.
                expect(log).toHaveBeenCalledTimes(queries.length);
            } finally {
                log.mockRestore();
            }
        });

        it("returns null supporterPreferences after a lapse, keeping Guild cosmetics", async () => {
            const user = await createProfile({
                guildTitleKey: "title_chronist",
                guildFrameKey: "frame_lantern_glow",
            });
            videoService.isSupporter.mockResolvedValueOnce(false);

            const response = await request(app.getHttpServer()).get(
                `/profile/${user}`,
            );

            expect(response.status).toBe(200);
            expect(response.body.supporterPreferences).toBeNull();
            expect(response.body.guildTitleKey).toBe("title_chronist");
            expect(response.body.guildFrameKey).toBe("frame_lantern_glow");
            expect(preferencesService.findOrDefaults).not.toHaveBeenCalled();
        });
    });
});
