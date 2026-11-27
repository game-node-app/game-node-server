import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { ConflictException, ForbiddenException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { createAwardsTestDatabase } from "../../test/awards/awards-test-database";
import { AchievementsProgressService } from "../achievements/achievements-progress.service";
import { UserLevel } from "../level/entities/user-level.entity";
import { LevelService } from "../level/level.service";
import { PlaytimeHistoryService } from "../playtime/playtime-history.service";
import { UserPlaytimeHistory } from "../playtime/entity/user-playtime-history.entity";
import { Profile } from "../profile/entities/profile.entity";
import {
    GuildBountyStatus,
    GuildLocale,
    GuildObjectiveType,
    GuildRank,
    GuildRewardKind,
    GuildRewardRarity,
    GuildSealReason,
    computeGuildRank,
} from "./guild.constants";
import { GuildBountiesService } from "./guild-bounties.service";
import { GuildCommunityBountyClaim } from "./entities/guild-community-bounty-claim.entity";
import { GuildCommunityBounty } from "./entities/guild-community-bounty.entity";
import { GuildProfile } from "./entities/guild-profile.entity";
import { GuildReward } from "./entities/guild-reward.entity";
import { GuildSealLedger } from "./entities/guild-seal-ledger.entity";
import { GuildTimeToBeatService } from "./guild-time-to-beat.service";
import { GameTimeToBeat } from "./entities/game-time-to-beat.entity";
import { GuildRankProgressionService } from "./guild-rank-progression.service";
import { GuildRewardsService } from "./guild-rewards.service";
import { GuildSealsService } from "./guild-seals.service";
import { CreateGuildBountyDto } from "./dto/guild-bounties.dto";

const NOW = new Date("2026-11-15T12:00:00Z");
const STARTS = new Date("2026-11-01T00:00:00Z");
const ENDS = new Date("2026-11-30T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

const rejectionOf = (promise: Promise<unknown>) =>
    promise.then(
        () => null,
        (error) => error,
    );

describe("GuildBountiesService (integration)", () => {
    jest.setTimeout(120000);

    const database = `guild_test_bounties_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    let db: Awaited<ReturnType<typeof createAwardsTestDatabase>>;
    let source: DataSource;
    let service: GuildBountiesService;
    let achievements: AchievementsProgressService;
    let nextGameId = 9_100_000;

    beforeAll(async () => {
        db = await createAwardsTestDatabase(database);
        source = db.source;

        const seals = new GuildSealsService(source);
        const level = new LevelService(source.getRepository(UserLevel));
        achievements = new AchievementsProgressService(source, level, {
            register: jest.fn(),
        } as any);
        const rewards = new GuildRewardsService(source, achievements, seals);
        const progression = new GuildRankProgressionService(source, rewards);
        const timeToBeat = new GuildTimeToBeatService(
            source.getRepository(GameTimeToBeat),
            { getTimesToBeat: jest.fn().mockResolvedValue([]) } as any,
        );
        service = new GuildBountiesService(
            source,
            timeToBeat,
            new PlaytimeHistoryService(
                source.getRepository(UserPlaytimeHistory),
                {} as any,
            ),
            rewards,
            seals,
            progression,
            level,
            achievements,
        );
    });

    afterEach(async () => {
        // Bounties are server-wide; archiving between tests keeps users isolated.
        await source.query("UPDATE guild_community_bounty SET status = ?", [
            GuildBountyStatus.ARCHIVED,
        ]);
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
        await source.query("INSERT INTO library (userId) VALUES (?)", [userId]);
        await source.getRepository(GuildProfile).insert({
            profileUserId: userId,
            xp,
            rank: computeGuildRank(xp).rank,
        });
        return userId;
    };

    const finishGame = async (
        userId: string,
        occurredAt = new Date(NOW.getTime() - DAY_MS),
    ) => {
        const gameId = nextGameId++;
        await source.query(
            `INSERT INTO collection_entry_status_history
                (libraryUserId, gameId, collectionEntryId, fromStatus, toStatus, source, occurredAt)
             VALUES (?, ?, NULL, ?, ?, 'manual', ?)`,
            [userId, gameId, "playing", "finished", occurredAt],
        );
        return gameId;
    };

    const translations = () => [
        {
            locale: GuildLocale.EN,
            title: "Spooky October",
            description: "Finish a horror game this month.",
        },
        {
            locale: GuildLocale.PT_BR,
            title: "Outubro Assombrado",
            description: "Termine um jogo de terror neste mês.",
        },
    ];

    const createBounty = (overrides: Partial<CreateGuildBountyDto> = {}) =>
        service.createAdminBounty({
            slug: `bounty-${randomUUID().slice(0, 8)}`,
            title: "Spooky October",
            description: "Finish a horror game this month.",
            objectiveType: GuildObjectiveType.FINISH_GAME,
            criteria: {},
            targetTotal: 10,
            minUserContribution: 1,
            maxUserContributionCap: 10,
            milestoneRewards: {},
            startsAt: STARTS,
            endsAt: ENDS,
            translations: translations(),
            ...overrides,
        });

    const publish = async (id: string, now = NOW) => {
        await service.publishAdminBounty(id, now);
    };

    const bountyOf = (id: string) =>
        source.getRepository(GuildCommunityBounty).findOneByOrFail({ id });

    const seedReward = async (
        key: string,
        values: {
            kind: GuildRewardKind;
            inChestPool?: boolean;
            rarity?: GuildRewardRarity;
            achievementId?: string | null;
        },
    ) => {
        const id = randomUUID();
        await source.getRepository(GuildReward).save({
            id,
            key,
            kind: values.kind,
            achievementId: values.achievementId ?? null,
            inChestPool: values.inChestPool ?? false,
            chestBonusXp: 0,
            chestBonusSeals: 0,
            rarity: values.rarity ?? GuildRewardRarity.COMMON,
            consumableKey: null,
            isActive: true,
        });
        return id;
    };

    describe("Admin CRUD and lifecycle", () => {
        it("creates, lists, publishes and archives a bounty with both locales", async () => {
            const created = await service.createAdminBounty({
                slug: "spooky-october-2026",
                title: "Spooky October",
                description: "Finish a horror game this month.",
                objectiveType: GuildObjectiveType.FINISH_GAME,
                criteria: {},
                targetTotal: 500,
                minUserContribution: 1,
                maxUserContributionCap: 10,
                milestoneRewards: { "25": { seals: 10 } },
                startsAt: STARTS,
                endsAt: ENDS,
                translations: translations(),
            });

            expect(created).toEqual(
                expect.objectContaining({
                    slug: "spooky-october-2026",
                    status: GuildBountyStatus.DRAFT,
                    currentTotal: 0,
                    publishedAt: null,
                    milestoneRewards: expect.objectContaining({
                        "25": { seals: 10 },
                        "50": {},
                        "100": {},
                        "150": {},
                    }),
                    translations: [
                        expect.objectContaining({ locale: GuildLocale.EN }),
                        expect.objectContaining({
                            locale: GuildLocale.PT_BR,
                        }),
                    ],
                }),
            );
            await expect(service.listAdminBounties()).resolves.toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ id: created.id }),
                ]),
            );

            const published = await service.publishAdminBounty(created.id, NOW);
            expect(published).toEqual(
                expect.objectContaining({
                    status: GuildBountyStatus.PUBLISHED,
                    publishedAt: NOW,
                }),
            );

            const listed = await service.listBounties(
                randomUUID(),
                GuildLocale.PT_BR,
                NOW,
            );
            expect(listed.bounties).toEqual([
                expect.objectContaining({
                    id: created.id,
                    title: "Outubro Assombrado",
                    description: "Termine um jogo de terror neste mês.",
                }),
            ]);

            const archived = await service.archiveAdminBounty(created.id);
            expect(archived.status).toBe(GuildBountyStatus.ARCHIVED);
            await expect(
                service.publishAdminBounty(created.id, NOW),
            ).rejects.toBeInstanceOf(ConflictException);
            await expect(
                service.listBounties(randomUUID(), undefined, NOW),
            ).resolves.toEqual({ bounties: [] });
        });

        it("rejects a duplicate slug", async () => {
            await createBounty({ slug: "duplicate-bounty" });
            const rejection = await rejectionOf(
                createBounty({ slug: "duplicate-bounty" }),
            );
            expect(rejection).toBeInstanceOf(ConflictException);
        });
    });

    describe("Rule lock", () => {
        it("locks quest rules once a contribution exists but still allows window edits", async () => {
            const userId = await createProfile();
            const bounty = await createBounty({ targetTotal: 10 });
            await publish(bounty.id);

            await finishGame(userId);
            await expect(
                service.recordContributionsForUser(userId, NOW),
            ).resolves.toBe(1);

            for (const change of [
                { targetTotal: 20 },
                { minUserContribution: 2 },
                { maxUserContributionCap: 2 },
                { objectiveType: GuildObjectiveType.WRITE_REVIEW },
                { criteria: { genreIds: [1] } },
                { startsAt: new Date(STARTS.getTime() - DAY_MS) },
                { milestoneRewards: { "25": { seals: 5 } } },
            ]) {
                const rejection = await rejectionOf(
                    service.updateAdminBounty(bounty.id, change),
                );
                expect(rejection).toBeInstanceOf(ConflictException);
                expect(rejection.getStatus()).toBe(409);
                expect(rejection.getResponse()).toEqual({
                    message: expect.any(String),
                    code: "guild_bounty_rules_locked",
                });
            }

            const extended = await service.updateAdminBounty(bounty.id, {
                endsAt: new Date(ENDS.getTime() + DAY_MS),
                title: "Spooky October Extended",
            });
            expect(extended).toEqual(
                expect.objectContaining({
                    title: "Spooky October Extended",
                    endsAt: new Date(ENDS.getTime() + DAY_MS),
                }),
            );
        });
    });

    describe("Contribution recording", () => {
        it("aggregates multiple users without consuming personal contract slots", async () => {
            const userA = await createProfile();
            const userB = await createProfile();
            for (let index = 0; index < 3; index++) {
                await source.query(
                    `INSERT INTO guild_contract
                        (id, profileUserId, category, templateKey, \`rank\`, xpReward,
                         sealsReward, objectiveType, criteria, progressCurrent, progressTarget,
                         status, acceptedAt)
                     VALUES (?, ?, 'weekly', 'weekend_sprint', 'D', 100,
                             0, 'finish_game', '{}', 0, 1, 'active', ?)`,
                    [randomUUID(), userA, STARTS],
                );
            }

            const bounty = await createBounty({ targetTotal: 10 });
            await publish(bounty.id);

            await finishGame(userA);
            await finishGame(userB);
            await expect(
                service.recordContributionsForUser(userA, NOW),
            ).resolves.toBe(1);
            await expect(
                service.recordContributionsForUser(userB, NOW),
            ).resolves.toBe(1);

            const stored = await bountyOf(bounty.id);
            expect(stored.currentTotal).toBe(2);
            const [{ total: contracts }] = await source.query(
                "SELECT COUNT(*) AS total FROM guild_contract WHERE profileUserId = ?",
                [userA],
            );
            expect(Number(contracts)).toBe(3);

            const [listA, listB] = await Promise.all([
                service.listBounties(userA, undefined, NOW),
                service.listBounties(userB, undefined, NOW),
            ]);
            expect(listA.bounties[0]).toEqual(
                expect.objectContaining({
                    currentTotal: 2,
                    userContribution: 1,
                    eligible: true,
                }),
            );
            expect(listB.bounties[0].userContribution).toBe(1);
        });

        it("deduplicates repeated evaluation of the same actions", async () => {
            const userId = await createProfile();
            const bounty = await createBounty({ targetTotal: 10 });
            await publish(bounty.id);

            await finishGame(userId);
            await finishGame(userId);
            await expect(
                service.recordContributionsForUser(userId, NOW),
            ).resolves.toBe(2);
            await expect(
                service.recordContributionsForUser(userId, NOW),
            ).resolves.toBe(0);

            const stored = await bountyOf(bounty.id);
            expect(stored.currentTotal).toBe(2);
            const [{ total }] = await source.query(
                "SELECT COUNT(*) AS total FROM guild_community_bounty_contribution WHERE bountyId = ?",
                [bounty.id],
            );
            expect(Number(total)).toBe(2);
        });

        it("caps a single user's contribution units", async () => {
            const userId = await createProfile();
            const bounty = await createBounty({
                targetTotal: 50,
                maxUserContributionCap: 2,
            });
            await publish(bounty.id);

            for (let index = 0; index < 4; index++) await finishGame(userId);
            await expect(
                service.recordContributionsForUser(userId, NOW),
            ).resolves.toBe(2);

            for (let index = 0; index < 2; index++) await finishGame(userId);
            await expect(
                service.recordContributionsForUser(userId, NOW),
            ).resolves.toBe(0);

            const stored = await bountyOf(bounty.id);
            expect(stored.currentTotal).toBe(2);
            const [{ total }] = await source.query(
                "SELECT COUNT(*) AS total FROM guild_community_bounty_contribution WHERE bountyId = ?",
                [bounty.id],
            );
            expect(Number(total)).toBe(2);
        });
    });

    describe("Milestone claims", () => {
        it("unlocks 25/50/100/150 and grants every milestone once", async () => {
            const userId = await createProfile();
            const chestCosmetic = await seedReward("title_bounty_chest", {
                kind: GuildRewardKind.TITLE,
                inChestPool: true,
                rarity: GuildRewardRarity.COMMON,
            });
            const milestoneReward = await seedReward("title_bounty_milestone", {
                kind: GuildRewardKind.TITLE,
            });

            const bounty = await createBounty({
                targetTotal: 4,
                maxUserContributionCap: 10,
                milestoneRewards: {
                    "25": { seals: 10 },
                    "50": { xp: 20 },
                    "100": { chestKind: GuildRewardKind.CHEST_BRONZE },
                    "150": { xp: 30, rewardId: milestoneReward },
                },
            });
            await publish(bounty.id);

            for (let index = 0; index < 6; index++) await finishGame(userId);
            await expect(
                service.recordContributionsForUser(userId, NOW),
            ).resolves.toBe(6);

            const listed = await service.listBounties(userId, undefined, NOW);
            expect(listed.bounties[0]).toEqual(
                expect.objectContaining({
                    currentTotal: 6,
                    progressPercent: 150,
                    userContribution: 6,
                    eligible: true,
                    hasClaimableMilestones: true,
                    milestones: [
                        expect.objectContaining({
                            milestone: 25,
                            unlocked: true,
                            claimed: false,
                            claimable: true,
                        }),
                        expect.objectContaining({
                            milestone: 50,
                            unlocked: true,
                        }),
                        expect.objectContaining({
                            milestone: 100,
                            unlocked: true,
                        }),
                        expect.objectContaining({
                            milestone: 150,
                            unlocked: true,
                        }),
                    ],
                }),
            );
            await expect(
                service.getBountiesSummary(userId, NOW),
            ).resolves.toEqual({
                activeBountiesCount: 1,
                claimableBountiesCount: 1,
            });

            const receipt = await service.claimBounty(userId, bounty.id, NOW);
            expect(receipt).toEqual(
                expect.objectContaining({
                    bountyId: bounty.id,
                    claimedMilestones: [25, 50, 100, 150],
                    newlyClaimedMilestones: [25, 50, 100, 150],
                    sealsAwarded: 25,
                    xpAwarded: 90,
                    globalXpAwarded: 22,
                    rankBefore: GuildRank.E,
                    rankAfter: GuildRank.E,
                }),
            );
            expect(receipt.chestResults).toEqual([
                expect.objectContaining({
                    chestKind: GuildRewardKind.CHEST_BRONZE,
                    unlockedCosmetic: expect.objectContaining({
                        id: chestCosmetic,
                    }),
                }),
            ]);
            expect(receipt.unlockedRewards).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ id: chestCosmetic }),
                    expect.objectContaining({ id: milestoneReward }),
                ]),
            );

            const profile = await source
                .getRepository(GuildProfile)
                .findOneByOrFail({ profileUserId: userId });
            expect(profile.xp).toBe(90);
            const ledger = await source.getRepository(GuildSealLedger).find({
                where: { profileUserId: userId },
                order: { id: "ASC" },
            });
            expect(
                ledger.map(({ delta, reason }) => ({ delta, reason })),
            ).toEqual([
                { delta: 10, reason: GuildSealReason.BOUNTY_CLAIM },
                { delta: 15, reason: GuildSealReason.BOUNTY_CLAIM },
            ]);

            const claim = await source
                .getRepository(GuildCommunityBountyClaim)
                .findOneByOrFail({
                    bountyId: bounty.id,
                    profileUserId: userId,
                });
            expect(claim.claimedMilestones).toEqual([25, 50, 100, 150]);

            const repeat = await rejectionOf(
                service.claimBounty(userId, bounty.id, NOW),
            );
            expect(repeat).toBeInstanceOf(ConflictException);
            expect(repeat.getStatus()).toBe(409);
            expect(repeat.getResponse()).toEqual({
                message: expect.any(String),
                code: "guild_bounty_nothing_to_claim",
            });
        });

        it("includes Prestige star Seals in the receipt when a claim crosses S+", async () => {
            const userId = await createProfile(9_990);
            await seedReward("title_bounty_relic", {
                kind: GuildRewardKind.TITLE,
                inChestPool: true,
                rarity: GuildRewardRarity.LEGENDARY,
            });
            const bounty = await createBounty({
                targetTotal: 1,
                milestoneRewards: { "25": { xp: 20 } },
            });
            await publish(bounty.id);
            await finishGame(userId);
            await service.recordContributionsForUser(userId, NOW);

            const receipt = await service.claimBounty(userId, bounty.id, NOW);
            const profile = await source
                .getRepository(GuildProfile)
                .findOneByOrFail({ profileUserId: userId });
            const prestigeSeals = (
                await source.getRepository(GuildSealLedger).find({
                    where: { profileUserId: userId },
                    order: { id: "ASC" },
                })
            )
                .filter(
                    ({ reason }) => reason === GuildSealReason.PRESTIGE_STAR,
                )
                .reduce((total, { delta }) => total + delta, 0);

            expect(profile.prestigeLevel).toBe(1);
            expect(prestigeSeals).toBe(120);
            expect(receipt.sealsAwarded).toBe(profile.sealsBalance);
            expect(receipt.sealsAwarded).toBe(prestigeSeals);
        });

        it("registers badge activity after claiming a badge milestone", async () => {
            const userId = await createProfile();
            const definitionId = randomUUID();
            await source.query(
                `INSERT INTO achievement_definition
                    (id, name, description, category, metric, criteria, icon, isHidden, status, publishedAt)
                 VALUES (?, 'Guild Badge', 'Guild Badge', 0, 'manual', '{}', '{}', 0, 'published', ?)`,
                [definitionId, NOW],
            );
            await source.query(
                "INSERT INTO achievement_tier (definitionId, level, threshold, expReward, obtainedCount) VALUES (?, 1, 1, 0, 0)",
                [definitionId],
            );
            const badge = await seedReward("badge_bounty_claim", {
                kind: GuildRewardKind.BADGE,
                achievementId: definitionId,
            });
            const bounty = await createBounty({
                targetTotal: 1,
                milestoneRewards: { "25": { rewardId: badge } },
            });
            await publish(bounty.id);
            await finishGame(userId);
            await service.recordContributionsForUser(userId, NOW);

            const spy = jest.spyOn(achievements, "registerGrantActivity");
            try {
                const receipt = await service.claimBounty(
                    userId,
                    bounty.id,
                    NOW,
                );
                expect(receipt.unlockedRewards).toEqual([
                    expect.objectContaining({ id: badge }),
                ]);
                expect(spy).toHaveBeenCalledWith(userId, {
                    obtainedAchievementId: expect.any(Number),
                    tier: 1,
                });
            } finally {
                spy.mockRestore();
            }
        });

        it("blocks non-contributors with 403", async () => {
            const contributor = await createProfile();
            const outsider = await createProfile();
            const bounty = await createBounty({ targetTotal: 1 });
            await publish(bounty.id);

            await finishGame(contributor);
            await service.recordContributionsForUser(contributor, NOW);

            const rejection = await rejectionOf(
                service.claimBounty(outsider, bounty.id, NOW),
            );
            expect(rejection).toBeInstanceOf(ForbiddenException);
            expect(rejection.getStatus()).toBe(403);
            expect(rejection.getResponse()).toEqual({
                message: expect.any(String),
                code: "guild_bounty_not_eligible",
            });
        });
    });

    describe("Post-end claim window", () => {
        it("accepts claims for 14 days after the end and rejects later ones", async () => {
            const userId = await createProfile();
            const lateUser = await createProfile();
            const bounty = await createBounty({
                targetTotal: 3,
                milestoneRewards: { "25": { seals: 5 } },
            });
            await publish(bounty.id);

            await finishGame(userId);
            await finishGame(lateUser);
            await service.recordContributionsForUser(userId, NOW);
            await service.recordContributionsForUser(lateUser, NOW);

            const withinWindow = await service.claimBounty(
                userId,
                bounty.id,
                new Date(ENDS.getTime() + 13 * DAY_MS),
            );
            expect(withinWindow.claimedMilestones).toEqual([25, 50]);

            const expired = await rejectionOf(
                service.claimBounty(
                    lateUser,
                    bounty.id,
                    new Date(ENDS.getTime() + 15 * DAY_MS),
                ),
            );
            expect(expired).toBeInstanceOf(ConflictException);
            expect(expired.getResponse()).toEqual({
                message: expect.any(String),
                code: "guild_bounty_not_claimable",
            });

            const listed = await service.listBounties(
                userId,
                undefined,
                new Date(ENDS.getTime() + 15 * DAY_MS),
            );
            expect(listed.bounties).toEqual([]);
        });
    });

    describe("Ready notifications", () => {
        it("queues one intent per eligible contributor, never duplicates", async () => {
            const userA = await createProfile();
            const userB = await createProfile();
            const bounty = await createBounty({ targetTotal: 2 });
            await publish(bounty.id);

            await finishGame(userA);
            await finishGame(userB);
            await service.recordContributionsForUser(userA, NOW);
            await service.recordContributionsForUser(userB, NOW);
            expect((await bountyOf(bounty.id)).reached100At).toEqual(NOW);

            await expect(service.fanOutReadyNotifications(NOW)).resolves.toBe(
                2,
            );
            const intents = async () =>
                source.query(
                    `SELECT recipientUserId, payload
                     FROM notification_outbox
                     WHERE eventType = 'guild.community-bounty-ready'`,
                );
            const first = await intents();
            expect(first).toHaveLength(2);
            expect(
                new Set(first.map((row: any) => row.recipientUserId)),
            ).toEqual(new Set([userA, userB]));
            for (const row of first) {
                const payload =
                    typeof row.payload === "string"
                        ? JSON.parse(row.payload)
                        : row.payload;
                expect(payload).toEqual({ bountyId: bounty.id });
            }

            await expect(service.fanOutReadyNotifications(NOW)).resolves.toBe(
                0,
            );
            await expect(intents()).resolves.toHaveLength(2);

            // 150% overkill must not re-notify the same contributors.
            await finishGame(userA);
            await service.recordContributionsForUser(userA, NOW);
            expect((await bountyOf(bounty.id)).currentTotal).toBe(3);
            await expect(service.fanOutReadyNotifications(NOW)).resolves.toBe(
                0,
            );
            await expect(intents()).resolves.toHaveLength(2);
        });
    });
});
