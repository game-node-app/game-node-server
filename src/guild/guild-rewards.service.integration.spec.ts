import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication, ForbiddenException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { DataSource } from "typeorm";
import { createAwardsTestDatabase } from "../../test/awards/awards-test-database";
import { achievementFixtures } from "../../test/achievements/achievement-fixtures";
import { AchievementsProgressService } from "../achievements/achievements-progress.service";
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
import { GuildRewardsService } from "./guild-rewards.service";
import {
    DUPLICATE_COSMETIC_BONUS_XP,
    GuildRewardKind,
} from "./guild.constants";
import { GuildReward } from "./entities/guild-reward.entity";
import { UserGuildReward } from "./entities/user-guild-reward.entity";

const EMPTY_FULFILLMENT = {
    bonusXp: 0,
    unlockedRewards: [],
    chestResult: null,
    pendingBadgeActivity: null,
};

describe("GuildRewardsService (integration)", () => {
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
        service = new GuildRewardsService(source, achievements);

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

    const createProfile = async (overrides: Partial<Profile> = {}) => {
        const userId = randomUUID();
        await source.getRepository(Profile).insert({
            userId,
            username: `g${userId.slice(0, 18)}`,
            ...overrides,
        });
        return userId;
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
            isActive: true,
            ...overrides,
        });
    };

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

    const descriptorOf = (reward: GuildReward) => ({
        id: reward.id,
        key: reward.key,
        achievementId: reward.achievementId,
        kind: reward.kind,
        inChestPool: reward.inChestPool,
        chestBonusXp: reward.chestBonusXp,
    });

    const fulfill = (
        userId: string,
        rewardId: string | null,
        contractId = randomUUID(),
    ) =>
        source.transaction((manager) =>
            service.fulfillContractRewardWithManager(
                manager,
                userId,
                contractId,
                rewardId,
            ),
        );

    const rejectionOf = async (promise: Promise<unknown>) =>
        promise.then(
            () => null,
            (error) => error,
        );

    describe("getUserRewards", () => {
        it("lists unlocked rewards alongside the equipped keys", async () => {
            const user = await createProfile({
                guildTitleKey: "title_listed",
                guildFrameKey: "frame_listed",
            });
            const title = await makeReward({
                kind: GuildRewardKind.TITLE,
                key: "title_listed",
            });
            const frame = await makeReward({
                kind: GuildRewardKind.AVATAR_FRAME,
                key: "frame_listed",
            });
            await unlock(user, title);
            await unlock(user, frame);

            const result = await service.getUserRewards(user);

            expect(result.equippedTitleKey).toBe("title_listed");
            expect(result.equippedFrameKey).toBe("frame_listed");
            expect(
                result.unlockedRewards.map((row) => row.reward.key).sort(),
            ).toEqual(["frame_listed", "title_listed"]);
            expect(
                result.unlockedRewards.every(
                    (row) => row.sourceContractId === null,
                ),
            ).toBe(true);

            await expect(service.getUserRewards(randomUUID())).resolves.toEqual(
                {
                    unlockedRewards: [],
                    equippedTitleKey: null,
                    equippedFrameKey: null,
                },
            );
        });
    });

    describe("updateCosmetics", () => {
        it("equips, partially updates and unequips one slot at a time", async () => {
            const user = await createProfile();
            const title = await makeReward({
                kind: GuildRewardKind.TITLE,
                key: "title_chronist",
            });
            const otherTitle = await makeReward({
                kind: GuildRewardKind.TITLE,
                key: "title_backlog_slayer",
            });
            const frame = await makeReward({
                kind: GuildRewardKind.AVATAR_FRAME,
                key: "frame_lantern_glow",
            });
            await unlock(user, title);
            await unlock(user, otherTitle);
            await unlock(user, frame);
            await source.getRepository(ProfileSupporterPreferences).insert({
                profileUserId: user,
                titleKey: "founder",
                accentColor: "#FF8800",
            });

            await expect(
                service.updateCosmetics(user, { guildTitleKey: title.key }),
            ).resolves.toEqual({
                guildTitleKey: title.key,
                guildFrameKey: null,
            });

            await expect(
                service.updateCosmetics(user, {
                    guildTitleKey: otherTitle.key,
                    guildFrameKey: frame.key,
                }),
            ).resolves.toEqual({
                guildTitleKey: otherTitle.key,
                guildFrameKey: frame.key,
            });

            await expect(
                service.updateCosmetics(user, { guildFrameKey: null }),
            ).resolves.toEqual({
                guildTitleKey: otherTitle.key,
                guildFrameKey: null,
            });

            await expect(service.updateCosmetics(user, {})).resolves.toEqual({
                guildTitleKey: otherTitle.key,
                guildFrameKey: null,
            });
            await expect(equippedOf(user)).resolves.toEqual({
                guildTitleKey: otherTitle.key,
                guildFrameKey: null,
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

        it("rejects unowned or wrong-kind keys without changing either slot", async () => {
            const user = await createProfile({
                guildTitleKey: "title_vested",
                guildFrameKey: "frame_vested",
            });
            const title = await makeReward({
                kind: GuildRewardKind.TITLE,
                key: "title_vested",
            });
            const frame = await makeReward({
                kind: GuildRewardKind.AVATAR_FRAME,
                key: "frame_vested",
            });
            const unownedTitle = await makeReward({
                kind: GuildRewardKind.TITLE,
                key: "title_retired",
            });
            await unlock(user, title);
            await unlock(user, frame);

            const wrongKind = await rejectionOf(
                service.updateCosmetics(user, {
                    guildTitleKey: frame.key,
                }),
            );
            expect(wrongKind).toBeInstanceOf(ForbiddenException);
            expect(wrongKind.getStatus()).toBe(403);
            expect(wrongKind.getResponse()).toEqual({
                message: expect.any(String),
                code: "guild_cosmetic_not_owned",
            });

            const unowned = await rejectionOf(
                service.updateCosmetics(user, {
                    guildTitleKey: unownedTitle.key,
                    guildFrameKey: null,
                }),
            );
            expect(unowned).toBeInstanceOf(ForbiddenException);
            expect(unowned.getResponse()).toEqual({
                message: expect.any(String),
                code: "guild_cosmetic_not_owned",
            });

            await expect(equippedOf(user)).resolves.toEqual({
                guildTitleKey: "title_vested",
                guildFrameKey: "frame_vested",
            });
        });
    });

    describe("fulfillContractRewardWithManager", () => {
        it("grants a badge once and returns the post-commit activity to the caller", async () => {
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
            expect(
                await source.query(
                    "SELECT tier FROM obtained_achievement WHERE profileUserId = ? AND achievementId = ?",
                    [user, definition.id],
                ),
            ).toEqual([{ tier: 1 }]);
        });

        it("unlocks a title or frame once and pays +50 XP on duplicates", async () => {
            const user = await createProfile();

            for (const kind of [
                GuildRewardKind.TITLE,
                GuildRewardKind.AVATAR_FRAME,
            ]) {
                const reward = await makeReward({ kind });
                const contractId = randomUUID();

                const first = await fulfill(user, reward.id, contractId);

                expect(first.bonusXp).toBe(0);
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

        it("opens the weekly chest with an unowned active pool cosmetic", async () => {
            const user = await createProfile();
            const chest = await makeReward({
                kind: GuildRewardKind.WEEKLY_CHEST,
                chestBonusXp: 75,
            });
            const alreadyOwned = await makeReward({
                kind: GuildRewardKind.TITLE,
                inChestPool: true,
            });
            const fresh = await makeReward({
                kind: GuildRewardKind.AVATAR_FRAME,
                inChestPool: true,
            });
            await unlock(user, alreadyOwned);

            const result = await fulfill(user, chest.id);

            expect(result.bonusXp).toBe(75);
            expect(result.chestResult).toEqual({
                bonusXp: 75,
                unlockedCosmetic: descriptorOf(fresh),
            });
            expect(result.unlockedRewards).toEqual([descriptorOf(fresh)]);
            await expect(unlockKeysOf(user)).resolves.toEqual(
                expect.arrayContaining([fresh.key, alreadyOwned.key]),
            );
        });

        it("pays the extra fallback XP when every active pool cosmetic is owned", async () => {
            const user = await createProfile();
            const chest = await makeReward({
                kind: GuildRewardKind.WEEKLY_CHEST,
                chestBonusXp: 75,
            });
            const pool = await source.getRepository(GuildReward).find({
                where: { inChestPool: true, isActive: true },
            });
            for (const cosmetic of pool) {
                if (
                    cosmetic.kind === GuildRewardKind.TITLE ||
                    cosmetic.kind === GuildRewardKind.AVATAR_FRAME
                ) {
                    await unlock(user, cosmetic);
                }
            }

            const result = await fulfill(user, chest.id);

            expect(result.bonusXp).toBe(75 + DUPLICATE_COSMETIC_BONUS_XP);
            expect(result.chestResult).toEqual({
                bonusXp: 75 + DUPLICATE_COSMETIC_BONUS_XP,
                unlockedCosmetic: null,
            });
            expect(result.unlockedRewards).toEqual([]);
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

        it("rolls cosmetic unlocks back with the caller's transaction", async () => {
            const user = await createProfile();
            const reward = await makeReward({ kind: GuildRewardKind.TITLE });

            await expect(
                source.transaction(async (manager) => {
                    await service.fulfillContractRewardWithManager(
                        manager,
                        user,
                        randomUUID(),
                        reward.id,
                    );
                    throw new Error("rollback");
                }),
            ).rejects.toThrow("rollback");

            await expect(
                source
                    .getRepository(UserGuildReward)
                    .countBy({ profileUserId: user }),
            ).resolves.toBe(0);
        });
    });

    describe("profile reads", () => {
        it("exposes Guild cosmetics on GET /profile/:id with a single SQL statement", async () => {
            const equipped = await createProfile({
                guildTitleKey: "title_chronist",
                guildFrameKey: "frame_lantern_glow",
            });
            const plain = await createProfile();

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
                // Same statement count with and without equipped cosmetics: zero extra SQL.
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
