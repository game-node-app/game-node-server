import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { createAwardsTestDatabase } from "../../test/awards/awards-test-database";
import { AchievementsProgressService } from "../achievements/achievements-progress.service";
import { UserLevel } from "../level/entities/user-level.entity";
import { LevelService } from "../level/level.service";
import { Profile } from "../profile/entities/profile.entity";
import { GuildPassportMilestoneStatus } from "./dto/guild-passport.dto";
import { GuildPassportMonth } from "./entities/guild-passport-month.entity";
import { GuildProfile } from "./entities/guild-profile.entity";
import { GuildReward } from "./entities/guild-reward.entity";
import { GuildSealLedger } from "./entities/guild-seal-ledger.entity";
import {
    computeGuildRank,
    GuildConsumableKey,
    GuildRank,
    GuildRewardKind,
    GuildRewardRarity,
    GuildSealReason,
    nextMonthResetAt,
} from "./guild.constants";
import { GuildPassportService } from "./guild-passport.service";
import { GuildRankProgressionService } from "./guild-rank-progression.service";
import { GuildRewardsService } from "./guild-rewards.service";
import { GuildSealsService } from "./guild-seals.service";

const rejectionOf = (promise: Promise<unknown>) =>
    promise.then(
        () => null,
        (error) => error,
    );

const NOVEMBER = new Date("2026-11-15T12:00:00-03:00");
const DECEMBER = new Date("2026-12-02T12:00:00-03:00");
const NOVEMBER_KEY = "2026-11";
const DECEMBER_KEY = "2026-12";

describe("GuildPassportService (integration)", () => {
    jest.setTimeout(120000);

    const database = `guild_test_passport_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    let db: Awaited<ReturnType<typeof createAwardsTestDatabase>>;
    let source: DataSource;
    let service: GuildPassportService;
    let seals: GuildSealsService;

    const chestPoolKeys = {
        [GuildRewardRarity.COMMON]: "title_passport_common",
        [GuildRewardRarity.UNCOMMON]: "title_passport_uncommon",
        [GuildRewardRarity.RARE]: "title_passport_rare",
    } as const;

    beforeAll(async () => {
        db = await createAwardsTestDatabase(database);
        source = db.source;

        seals = new GuildSealsService(source);
        const level = new LevelService(source.getRepository(UserLevel));
        const achievements = new AchievementsProgressService(source, level, {
            register: jest.fn(),
        } as any);
        const rewards = new GuildRewardsService(source, achievements, seals);
        const progression = new GuildRankProgressionService(source, rewards);
        service = new GuildPassportService(
            source,
            rewards,
            seals,
            progression,
            level,
        );

        // The test schema is synchronized from entities, so the migration's chest
        // pool seeds are recreated here: one cosmetic per Passport chest rarity.
        for (const [rarity, key] of Object.entries(chestPoolKeys)) {
            await source.getRepository(GuildReward).save({
                id: randomUUID(),
                key,
                kind: GuildRewardKind.TITLE,
                achievementId: null,
                inChestPool: true,
                chestBonusXp: 0,
                chestBonusSeals: 0,
                rarity: rarity as GuildRewardRarity,
                consumableKey: null,
                isActive: true,
            });
        }
    });

    afterAll(async () => {
        await db?.destroy();
    });

    const createProfile = async (xp = 0) => {
        const userId = randomUUID();
        await source.getRepository(Profile).insert({
            userId,
            username: `g${userId.slice(0, 18)}`,
        });
        await source.getRepository(GuildProfile).insert({
            profileUserId: userId,
            xp,
            rank: computeGuildRank(xp).rank,
        });
        return userId;
    };

    const transaction = <T>(work: (manager: EntityManager) => Promise<T>) =>
        source.transaction(work);

    const complete = (userId: string, claimedAt = NOVEMBER) =>
        transaction((manager) =>
            service.recordContractCompletionWithManager(
                manager,
                userId,
                claimedAt,
            ),
        );

    const completeMany = async (
        userId: string,
        count: number,
        claimedAt = NOVEMBER,
    ) => {
        for (let index = 0; index < count; index++) {
            await complete(userId, claimedAt);
        }
    };

    const profileOf = (userId: string) =>
        source
            .getRepository(GuildProfile)
            .findOneByOrFail({ profileUserId: userId });

    const monthRowOf = (userId: string, monthKey = NOVEMBER_KEY) =>
        source
            .getRepository(GuildPassportMonth)
            .findOneBy({ profileUserId: userId, monthKey });

    const ledgerOf = (userId: string) =>
        source.getRepository(GuildSealLedger).find({
            where: { profileUserId: userId },
            order: { id: "ASC" },
        });

    const unlockedCosmeticKeysOf = async (userId: string) =>
        (
            await source.query(
                "SELECT gr.`key` AS `key` FROM user_guild_reward ugr JOIN guild_reward gr ON gr.id = ugr.rewardId WHERE ugr.profileUserId = ? ORDER BY gr.`key`",
                [userId],
            )
        ).map((row: { key: string }) => row.key);

    describe("Stamp tracking", () => {
        it("increments the contract's São Paulo month and reports milestone statuses", async () => {
            const userId = await createProfile();

            await expect(complete(userId, NOVEMBER)).resolves.toEqual({
                monthKey: NOVEMBER_KEY,
                completedContractsCount: 1,
            });
            await expect(complete(userId, NOVEMBER)).resolves.toEqual({
                monthKey: NOVEMBER_KEY,
                completedContractsCount: 2,
            });

            const passport = await service.getPassport(userId, NOVEMBER);
            expect(passport).toEqual({
                monthKey: NOVEMBER_KEY,
                completedContractsCount: 2,
                resetsAt: nextMonthResetAt(NOVEMBER),
                milestones: [
                    {
                        milestone: 2,
                        status: GuildPassportMilestoneStatus.CLAIMABLE,
                        chestKind: GuildRewardKind.CHEST_BRONZE,
                        sealsReward: 25,
                        consumableKey: null,
                        consumableQuantity: 0,
                    },
                    {
                        milestone: 4,
                        status: GuildPassportMilestoneStatus.LOCKED,
                        chestKind: GuildRewardKind.CHEST_SILVER,
                        sealsReward: 50,
                        consumableKey: null,
                        consumableQuantity: 0,
                    },
                    {
                        milestone: 6,
                        status: GuildPassportMilestoneStatus.LOCKED,
                        chestKind: GuildRewardKind.CHEST_GOLD,
                        sealsReward: 100,
                        consumableKey: GuildConsumableKey.HOURGLASS,
                        consumableQuantity: 1,
                    },
                ],
            });
            await expect(
                service.getPassportSummary(userId, NOVEMBER),
            ).resolves.toEqual({
                monthKey: NOVEMBER_KEY,
                completedContractsCount: 2,
                claimableMilestones: [2],
            });

            await expect(monthRowOf(userId)).resolves.toEqual(
                expect.objectContaining({
                    completedContractsCount: 2,
                    claimedMilestones: [],
                }),
            );
        });

        it("assigns stamps by São Paulo midnight, not UTC", async () => {
            const userId = await createProfile();

            // 2026-12-01T02:59Z is still 2026-11-30 23:59 in São Paulo.
            await expect(
                complete(userId, new Date("2026-12-01T02:59:00Z")),
            ).resolves.toEqual({
                monthKey: NOVEMBER_KEY,
                completedContractsCount: 1,
            });
            await expect(
                complete(userId, new Date("2026-12-01T03:00:00Z")),
            ).resolves.toEqual({
                monthKey: DECEMBER_KEY,
                completedContractsCount: 1,
            });
        });

        it("serializes concurrent stamp increments without losing a completion", async () => {
            const userId = await createProfile();

            const outcomes = await Promise.all(
                Array.from({ length: 3 }, () => complete(userId, NOVEMBER)),
            );

            expect(
                outcomes
                    .map(
                        ({ completedContractsCount }) =>
                            completedContractsCount,
                    )
                    .sort((a, b) => a - b),
            ).toEqual([1, 2, 3]);
            await expect(monthRowOf(userId)).resolves.toEqual(
                expect.objectContaining({ completedContractsCount: 3 }),
            );
        });
    });

    describe("Month rollover", () => {
        it("starts a new month at zero and keeps the previous month's claims", async () => {
            const userId = await createProfile();
            await completeMany(userId, 2, NOVEMBER);
            await service.claimMilestone(userId, 2, NOVEMBER);

            const december = await service.getPassport(userId, DECEMBER);
            expect(december).toEqual({
                monthKey: DECEMBER_KEY,
                completedContractsCount: 0,
                resetsAt: nextMonthResetAt(DECEMBER),
                milestones: expect.arrayContaining([
                    expect.objectContaining({
                        milestone: 2,
                        status: GuildPassportMilestoneStatus.LOCKED,
                    }),
                ]),
            });

            const rejection = await rejectionOf(
                service.claimMilestone(userId, 2, DECEMBER),
            );
            expect(rejection).toBeInstanceOf(ConflictException);
            expect(rejection.getStatus()).toBe(409);
            expect(rejection.getResponse()).toEqual({
                message: expect.any(String),
                code: "guild_passport_milestone_not_reached",
            });

            // November keeps its own stamps and claimed milestone untouched.
            const november = await service.getPassport(userId, NOVEMBER);
            expect(november.completedContractsCount).toBe(2);
            expect(november.milestones[0].status).toBe(
                GuildPassportMilestoneStatus.CLAIMED,
            );

            await expect(complete(userId, DECEMBER)).resolves.toEqual({
                monthKey: DECEMBER_KEY,
                completedContractsCount: 1,
            });
        });
    });

    describe("Milestone claims", () => {
        it("rejects milestones outside 2, 4 and 6 with 400", async () => {
            const userId = await createProfile();
            await completeMany(userId, 6);

            for (const milestone of [0, 3, 8]) {
                const rejection = await rejectionOf(
                    service.claimMilestone(userId, milestone, NOVEMBER),
                );
                expect(rejection).toBeInstanceOf(BadRequestException);
                expect(rejection.getStatus()).toBe(400);
                expect(rejection.getResponse()).toEqual({
                    message: expect.any(String),
                    code: "guild_passport_invalid_milestone",
                });
            }

            await expect(ledgerOf(userId)).resolves.toEqual([]);
            await expect(unlockedCosmeticKeysOf(userId)).resolves.toEqual([]);
        });

        it("rejects a milestone the month has not reached with 409", async () => {
            const userId = await createProfile();
            await completeMany(userId, 1);

            const rejection = await rejectionOf(
                service.claimMilestone(userId, 2, NOVEMBER),
            );
            expect(rejection).toBeInstanceOf(ConflictException);
            expect(rejection.getStatus()).toBe(409);
            expect(rejection.getResponse()).toEqual({
                message: expect.any(String),
                code: "guild_passport_milestone_not_reached",
            });

            await expect(ledgerOf(userId)).resolves.toEqual([]);
            await expect(monthRowOf(userId)).resolves.toEqual(
                expect.objectContaining({
                    completedContractsCount: 1,
                    claimedMilestones: [],
                }),
            );
        });

        it("grants all three milestone rewards exactly once", async () => {
            const userId = await createProfile();
            await completeMany(userId, 6);

            await expect(
                service.claimMilestone(userId, 2, NOVEMBER),
            ).resolves.toEqual(
                expect.objectContaining({
                    monthKey: NOVEMBER_KEY,
                    milestone: 2,
                    claimedMilestones: [2],
                    completedContractsCount: 6,
                    sealsAwarded: 40,
                    consumableKey: null,
                    consumableQuantity: 0,
                    xpAwarded: 40,
                    globalXpAwarded: 10,
                    rankBefore: GuildRank.E,
                    rankAfter: GuildRank.E,
                    chestResult: expect.objectContaining({
                        chestKind: GuildRewardKind.CHEST_BRONZE,
                        bonusXp: 40,
                        bonusSeals: 15,
                        unlockedCosmetic: expect.objectContaining({
                            key: chestPoolKeys[GuildRewardRarity.COMMON],
                        }),
                    }),
                }),
            );
            await expect(
                service.claimMilestone(userId, 4, NOVEMBER),
            ).resolves.toEqual(
                expect.objectContaining({
                    claimedMilestones: [2, 4],
                    sealsAwarded: 80,
                    xpAwarded: 75,
                    globalXpAwarded: 18,
                    chestResult: expect.objectContaining({
                        chestKind: GuildRewardKind.CHEST_SILVER,
                        unlockedCosmetic: expect.objectContaining({
                            key: chestPoolKeys[GuildRewardRarity.UNCOMMON],
                        }),
                    }),
                }),
            );
            const six = await service.claimMilestone(userId, 6, NOVEMBER);
            expect(six).toEqual(
                expect.objectContaining({
                    claimedMilestones: [2, 4, 6],
                    sealsAwarded: 160,
                    consumableKey: GuildConsumableKey.HOURGLASS,
                    consumableQuantity: 1,
                    xpAwarded: 125,
                    globalXpAwarded: 31,
                    chestResult: expect.objectContaining({
                        chestKind: GuildRewardKind.CHEST_GOLD,
                        unlockedCosmetic: expect.objectContaining({
                            key: chestPoolKeys[GuildRewardRarity.RARE],
                        }),
                    }),
                }),
            );

            const ledger = await ledgerOf(userId);
            expect(
                ledger.map(({ delta, reason }) => ({ delta, reason })),
            ).toEqual([
                { delta: 15, reason: GuildSealReason.CHEST_PAYOUT },
                { delta: 25, reason: GuildSealReason.PASSPORT_CLAIM },
                { delta: 30, reason: GuildSealReason.CHEST_PAYOUT },
                { delta: 50, reason: GuildSealReason.PASSPORT_CLAIM },
                { delta: 60, reason: GuildSealReason.CHEST_PAYOUT },
                { delta: 100, reason: GuildSealReason.PASSPORT_CLAIM },
            ]);
            expect(
                ledger
                    .filter(
                        ({ reason }) =>
                            reason === GuildSealReason.PASSPORT_CLAIM,
                    )
                    .map(({ referenceId }) => referenceId),
            ).toEqual([
                "passport:2026-11:2",
                "passport:2026-11:4",
                "passport:2026-11:6",
            ]);
            await expect(profileOf(userId)).resolves.toEqual(
                expect.objectContaining({ sealsBalance: 280, xp: 240 }),
            );
            await expect(seals.getConsumableBalances(userId)).resolves.toEqual(
                expect.objectContaining({
                    [GuildConsumableKey.HOURGLASS]: expect.any(Number),
                }),
            );
            const consumables = await seals.getConsumableBalances(userId);
            expect(
                consumables[GuildConsumableKey.HOURGLASS],
            ).toBeGreaterThanOrEqual(1);
            await expect(monthRowOf(userId)).resolves.toEqual(
                expect.objectContaining({ claimedMilestones: [2, 4, 6] }),
            );

            const passport = await service.getPassport(userId, NOVEMBER);
            expect(passport.milestones.map(({ status }) => status)).toEqual([
                GuildPassportMilestoneStatus.CLAIMED,
                GuildPassportMilestoneStatus.CLAIMED,
                GuildPassportMilestoneStatus.CLAIMED,
            ]);
            await expect(
                service.getPassportSummary(userId, NOVEMBER),
            ).resolves.toEqual({
                monthKey: NOVEMBER_KEY,
                completedContractsCount: 6,
                claimableMilestones: [],
            });
        });

        it("includes Prestige star Seals in the receipt when the chest crosses S+", async () => {
            const userId = await createProfile(9_990);
            await completeMany(userId, 2);

            const receipt = await service.claimMilestone(userId, 2, NOVEMBER);
            const profile = await profileOf(userId);
            const prestigeSeals = (await ledgerOf(userId))
                .filter(
                    ({ reason }) => reason === GuildSealReason.PRESTIGE_STAR,
                )
                .reduce((total, { delta }) => total + delta, 0);

            expect(profile.prestigeLevel).toBe(1);
            expect(prestigeSeals).toBe(120);
            expect(receipt.sealsAwarded).toBe(profile.sealsBalance);
            expect(receipt.sealsAwarded).toBe(
                25 + receipt.chestResult.bonusSeals + prestigeSeals,
            );
        });

        it("rejects a repeated claim with 409 without granting again", async () => {
            const userId = await createProfile();
            await completeMany(userId, 6);
            const first = await service.claimMilestone(userId, 6, NOVEMBER);
            const ledgerAfterFirst = await ledgerOf(userId);
            const consumablesAfterFirst =
                await seals.getConsumableBalances(userId);

            const rejection = await rejectionOf(
                service.claimMilestone(userId, 6, NOVEMBER),
            );
            expect(rejection).toBeInstanceOf(ConflictException);
            expect(rejection.getStatus()).toBe(409);
            expect(rejection.getResponse()).toEqual({
                message: expect.any(String),
                code: "guild_passport_milestone_already_claimed",
            });

            await expect(ledgerOf(userId)).resolves.toEqual(ledgerAfterFirst);
            await expect(seals.getConsumableBalances(userId)).resolves.toEqual(
                consumablesAfterFirst,
            );
            await expect(profileOf(userId)).resolves.toEqual(
                expect.objectContaining({
                    sealsBalance: first.sealsAwarded,
                    xp: first.xpAwarded,
                }),
            );
        });

        it("lets exactly one of two concurrent claims win", async () => {
            const userId = await createProfile();
            await completeMany(userId, 2);

            const outcomes = await Promise.allSettled([
                service.claimMilestone(userId, 2, NOVEMBER),
                service.claimMilestone(userId, 2, NOVEMBER),
            ]);

            const fulfilled = outcomes.filter(
                (outcome) => outcome.status === "fulfilled",
            );
            const rejected = outcomes.filter(
                (outcome): outcome is PromiseRejectedResult =>
                    outcome.status === "rejected",
            );
            expect(fulfilled).toHaveLength(1);
            expect(rejected).toHaveLength(1);
            expect(rejected[0].reason).toBeInstanceOf(ConflictException);
            expect(rejected[0].reason.getResponse()).toEqual({
                message: expect.any(String),
                code: "guild_passport_milestone_already_claimed",
            });

            await expect(profileOf(userId)).resolves.toEqual(
                expect.objectContaining({ sealsBalance: 40 }),
            );
            await expect(ledgerOf(userId)).resolves.toHaveLength(2);
            await expect(unlockedCosmeticKeysOf(userId)).resolves.toEqual([
                chestPoolKeys[GuildRewardRarity.COMMON],
            ]);
            await expect(monthRowOf(userId)).resolves.toEqual(
                expect.objectContaining({ claimedMilestones: [2] }),
            );
        });
    });
});
