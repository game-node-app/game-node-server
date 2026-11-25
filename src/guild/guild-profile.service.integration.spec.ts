import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { createAwardsTestDatabase } from "../../test/awards/awards-test-database";
import { AchievementsProgressService } from "../achievements/achievements-progress.service";
import { CollectionEntryStatus } from "../collections/collections-entries/collections-entries.constants";
import { UserLevel } from "../level/entities/user-level.entity";
import { LevelService } from "../level/level.service";
import { UserPlaytimeHistory } from "../playtime/entity/user-playtime-history.entity";
import { PlaytimeHistoryService } from "../playtime/playtime-history.service";
import { Profile } from "../profile/entities/profile.entity";
import { YearGoal } from "../recap/entity/year-goal.entity";
import { RecapGoalsService } from "../recap/recap-goals.service";
import { IgdbPlaytimeSyncService } from "../sync/igdb/playtime/igdb-playtime-sync.service";
import {
    GUILD_RANK_PROMOTION_REWARDS,
    GuildBountyStatus,
    GuildContractStatus,
    GuildEventStatus,
    GuildObjectiveType,
    GuildRank,
    GuildRewardKind,
    GuildRewardRarity,
    LinaPose,
    LinaTrigger,
    currentWeekStart,
} from "./guild.constants";
import { GameTimeToBeat } from "./entities/game-time-to-beat.entity";
import { GuildProfile } from "./entities/guild-profile.entity";
import { GuildReward } from "./entities/guild-reward.entity";
import { GuildBoardService } from "./guild-board.service";
import { GuildBountiesService } from "./guild-bounties.service";
import { GuildChainsService } from "./guild-chains.service";
import { GuildContractEvaluatorService } from "./guild-contract-evaluator.service";
import { GuildContractsService } from "./guild-contracts.service";
import { GuildPassportService } from "./guild-passport.service";
import { GuildProfileService } from "./guild-profile.service";
import { GuildRankProgressionService } from "./guild-rank-progression.service";
import { GuildRewardsService } from "./guild-rewards.service";
import { GuildSealsService } from "./guild-seals.service";
import { GuildTimeToBeatService } from "./guild-time-to-beat.service";
import { LinaReceptionService } from "./lina-reception.service";

const kindForRewardKey = (key: string): GuildRewardKind => {
    if (key.startsWith("frame_")) return GuildRewardKind.AVATAR_FRAME;
    if (key.startsWith("decor_")) return GuildRewardKind.TAVERN_DECOR;
    if (key.startsWith("license_")) return GuildRewardKind.LICENSE_THEME;
    if (key.startsWith("stamp_")) return GuildRewardKind.STAMP_STYLE;
    return GuildRewardKind.TITLE;
};

describe("Guild profile and Lina reception (integration)", () => {
    jest.setTimeout(120000);

    const database = `guild_test_profile_lina_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const dayMs = 24 * 60 * 60 * 1000;
    let db: Awaited<ReturnType<typeof createAwardsTestDatabase>> | undefined;
    let source: DataSource;
    let profiles: GuildProfileService;
    let lina: LinaReceptionService;
    let contracts: GuildContractsService;
    let nextGameId = 900_000;

    beforeAll(async () => {
        db = await createAwardsTestDatabase(database);
        source = db.source;
        const achievements = new AchievementsProgressService(
            source,
            new LevelService(source.getRepository(UserLevel)),
            { register: jest.fn() } as any,
        );
        const level = new LevelService(source.getRepository(UserLevel));
        const timeToBeat = new GuildTimeToBeatService(
            source.getRepository(GameTimeToBeat),
            {
                getTimesToBeat: jest.fn(),
            } as unknown as IgdbPlaytimeSyncService,
        );
        const seals = new GuildSealsService(source);
        const rewards = new GuildRewardsService(source, achievements, seals);
        const progression = new GuildRankProgressionService(source, rewards);
        const passport = new GuildPassportService(
            source,
            rewards,
            seals,
            progression,
            level,
        );
        const chains = new GuildChainsService(source, seals, timeToBeat);
        const playtimeHistory = new PlaytimeHistoryService(
            source.getRepository(UserPlaytimeHistory),
            {} as any,
        );
        const bounties = new GuildBountiesService(
            source,
            timeToBeat,
            playtimeHistory,
            rewards,
            seals,
            progression,
            level,
        );
        profiles = new GuildProfileService(
            source.getRepository(GuildProfile),
            source.getRepository(Profile),
            source,
            new RecapGoalsService(source.getRepository(YearGoal), source),
            progression,
        );
        lina = new LinaReceptionService(source, profiles);
        contracts = new GuildContractsService(
            source,
            profiles,
            new GuildBoardService(source, timeToBeat),
            rewards,
            new GuildContractEvaluatorService(
                source,
                timeToBeat,
                playtimeHistory,
            ),
            lina,
            level,
            achievements,
            timeToBeat,
            seals,
            progression,
            passport,
            chains,
            bounties,
        );

        // The test schema is synchronized from entities, so the migration's Rank
        // promotion packages are recreated here for lazy reconciliation.
        for (const keys of Object.values(GUILD_RANK_PROMOTION_REWARDS)) {
            for (const key of keys) {
                await source.getRepository(GuildReward).save({
                    id: randomUUID(),
                    key,
                    kind: kindForRewardKey(key),
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
    });

    afterAll(async () => {
        await db?.destroy();
    });

    async function user() {
        const userId = randomUUID();
        await source.query(
            "INSERT INTO profile (userId, username, createdAt) VALUES (?, ?, ?)",
            [
                userId,
                `u-${userId.slice(0, 8)}`,
                new Date("2025-01-02T03:04:05Z"),
            ],
        );
        await source.query("INSERT INTO library (userId) VALUES (?)", [userId]);
        return userId;
    }

    async function game(name?: string) {
        const id = nextGameId++;
        await source.query(
            "INSERT INTO game (id, name, slug) VALUES (?, ?, ?)",
            [id, name ?? `Game ${id}`, `game-${id}`],
        );
        return id;
    }

    async function entry(
        userId: string,
        gameId: number,
        values: {
            status?: CollectionEntryStatus;
            createdAt?: Date;
            updatedAt?: Date;
            plannedAt?: Date;
            finishedAt?: Date;
        } = {},
    ) {
        const id = randomUUID();
        const createdAt = values.createdAt ?? new Date();
        await source.query(
            `INSERT INTO collection_entry
                (id, gameId, libraryUserId, status, createdAt, updatedAt, plannedAt, finishedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                gameId,
                userId,
                values.status ?? CollectionEntryStatus.PLANNED,
                createdAt,
                values.updatedAt ?? createdAt,
                values.plannedAt ?? null,
                values.finishedAt ?? null,
            ],
        );
        return id;
    }

    async function finishHistory(userId: string, gameId: number, at: Date) {
        await source.query(
            `INSERT INTO collection_entry_status_history
                (libraryUserId, gameId, collectionEntryId, fromStatus, toStatus, source, occurredAt)
             VALUES (?, ?, NULL, NULL, ?, 'manual', ?)`,
            [userId, gameId, CollectionEntryStatus.FINISHED, at],
        );
    }

    async function review(
        userId: string,
        gameId: number,
        collectionEntryId?: string,
        createdAt = new Date(),
    ) {
        await source.query(
            `INSERT INTO review
                (id, content, rating, gameId, profileUserId, collectionEntryId, createdAt)
             VALUES (?, 'ok', 5, ?, ?, ?, ?)`,
            [
                randomUUID(),
                gameId,
                userId,
                collectionEntryId ?? (await entry(userId, gameId)),
                createdAt,
            ],
        );
    }

    async function event(
        publishedAt: Date,
        startsAt: Date,
        endsAt: Date,
        status = GuildEventStatus.PUBLISHED,
    ) {
        const id = randomUUID();
        await source.query(
            `INSERT INTO guild_event
                (id, slug, title, description, \`rank\`, xpReward, objectiveType, targetCount, criteria, startsAt, endsAt, status, publishedAt)
             VALUES (?, ?, 'Event', 'Event', 'E', 100, 'finish_game', 1, '{}', ?, ?, ?, ?)`,
            [id, `slug-${id}`, startsAt, endsAt, status, publishedAt],
        );
        return id;
    }

    async function readyContract(userId: string, targetGameId: number | null) {
        const id = randomUUID();
        const readyAt = new Date("2026-06-01T12:00:00Z");
        await source.query(
            `INSERT INTO guild_contract
                (id, profileUserId, category, templateKey, \`rank\`, xpReward, objectiveType, criteria, targetGameId, progressCurrent, progressTarget, status, acceptedAt, readyAt)
             VALUES (?, ?, 'library', 'forgotten_relic', 'B', 250, 'finish_game', '{}', ?, 1, 1, ?, ?, ?)`,
            [
                id,
                userId,
                targetGameId,
                GuildContractStatus.READY_TO_CLAIM,
                readyAt,
                readyAt,
            ],
        );
        return id;
    }

    async function passportMonth(
        userId: string,
        monthKey: string,
        completedContractsCount: number,
    ) {
        await source.query(
            `INSERT INTO guild_passport_month
                (profileUserId, monthKey, completedContractsCount, claimedMilestones)
             VALUES (?, ?, ?, JSON_ARRAY())`,
            [userId, monthKey, completedContractsCount],
        );
    }

    async function startChainProgress(
        userId: string,
        stageIndex = 0,
        now = new Date(),
    ) {
        const id = randomUUID();
        await source.query(
            `INSERT INTO guild_user_chain
                (id, profileUserId, chainKey, status, currentStageIndex, boundTargetGameId, activeContractId, startedAt, completedAt)
             VALUES (?, ?, 'pathfinders_arc', 'in_progress', ?, NULL, NULL, ?, NULL)`,
            [id, userId, stageIndex, now],
        );
        return id;
    }

    async function publishedBounty(userId: string, now: Date) {
        const id = randomUUID();
        await source.query(
            `INSERT INTO guild_community_bounty
                (id, slug, title, description, objectiveType, criteria, targetTotal, currentTotal, minUserContribution, maxUserContributionCap, milestoneRewards, startsAt, endsAt, status, publishedAt)
             VALUES (?, ?, 'Community Bounty', 'Finish games together.', ?, '{}', 100, 25, 1, 10, ?, ?, ?, ?, ?)`,
            [
                id,
                `slug-${id}`,
                GuildObjectiveType.FINISH_GAME,
                JSON.stringify({ "25": { seals: 10 } }),
                new Date(now.getTime() - dayMs),
                new Date(now.getTime() + 10 * dayMs),
                GuildBountyStatus.PUBLISHED,
                new Date(now.getTime() - dayMs),
            ],
        );
        await source.query(
            `INSERT INTO guild_community_bounty_contribution
                (bountyId, profileUserId, sourceKey, units, contributedAt)
             VALUES (?, ?, ?, 1, ?)`,
            [id, userId, `game:${nextGameId++}`, now],
        );
        return id;
    }

    const reload = (userId: string) => profiles.ensureProfile(userId);

    it("creates a single Guild profile for concurrent first visits", async () => {
        const userId = await user();

        const members = await Promise.all(
            Array.from({ length: 5 }, () => profiles.ensureProfile(userId)),
        );
        const licenseNumbers = new Set(members.map((m) => m.licenseNumber));
        expect(licenseNumbers.size).toBe(1);

        const license = await profiles.getLicense(userId);
        expect(license.licenseNumber).toBe([...licenseNumbers][0]);
        expect(license).toMatchObject({
            rank: GuildRank.E,
            xp: 0,
            currentRankMinXp: 0,
            nextRank: GuildRank.D,
            nextRankXp: 300,
            xpToNextRank: 300,
            memberSince: new Date("2025-01-02T03:04:05Z"),
            equippedTitleKey: null,
            equippedFrameKey: null,
            stats: { finishedGames: 0, backlogGames: 0, reviewsCount: 0 },
        });
        expect(
            await source.query(
                "SELECT COUNT(*) AS total FROM guild_profile WHERE profileUserId = ?",
                [userId],
            ),
        ).toEqual([{ total: 1 }]);
    });

    it("reads an existing Guild profile without inserting and inserts for a missing one", async () => {
        const userId = await user();
        const created = await profiles.ensureProfile(userId);
        const query = jest.spyOn(source.manager, "query");
        const inserts = () =>
            query.mock.calls.filter(([sql]) =>
                /INSERT\s+IGNORE/i.test(String(sql)),
            );

        try {
            const existing = await profiles.ensureProfile(userId);
            expect(existing.licenseNumber).toBe(created.licenseNumber);
            expect(inserts()).toEqual([]);

            await profiles.ensureProfile(await user());
            expect(inserts()).toHaveLength(1);
        } finally {
            query.mockRestore();
        }
    });

    it("aggregates License stats, rank progress and equipped cosmetics", async () => {
        const userId = await user();
        const finishedA = await game("Finished A");
        const finishedB = await game("Finished B");
        const backlog = await game("Backlog");
        const finishedEntry = await entry(userId, finishedA, {
            status: CollectionEntryStatus.FINISHED,
            finishedAt: new Date("2026-02-01T00:00:00Z"),
        });
        await entry(userId, finishedB, {
            status: CollectionEntryStatus.FINISHED,
            finishedAt: new Date("2026-03-01T00:00:00Z"),
        });
        await entry(userId, backlog, {
            status: CollectionEntryStatus.PLANNED,
            plannedAt: new Date("2026-04-01T00:00:00Z"),
        });
        await review(userId, finishedA, finishedEntry);
        await profiles.ensureProfile(userId);
        await source.query(
            "UPDATE guild_profile SET xp = 1240 WHERE profileUserId = ?",
            [userId],
        );
        await source.query(
            "UPDATE profile SET guildTitleKey = ?, guildFrameKey = ? WHERE userId = ?",
            ["title_chronist", "frame_parchment_seal", userId],
        );

        const license = await profiles.getLicense(userId);
        expect(license).toMatchObject({
            xp: 1240,
            rank: GuildRank.C,
            currentRankMinXp: 800,
            nextRank: GuildRank.B,
            nextRankXp: 2000,
            xpToNextRank: 760,
            equippedTitleKey: "title_chronist",
            equippedFrameKey: "frame_parchment_seal",
            stats: { finishedGames: 2, backlogGames: 1, reviewsCount: 1 },
        });
    });

    it("summarizes the current year goal and reports null when unset", async () => {
        const userId = await user();
        const now = new Date("2026-06-15T12:00:00Z");
        expect(await profiles.getCurrentYearGoal(userId, now)).toBeNull();

        await source.query(
            "INSERT INTO year_goal (profileUserId, year, finishedGamesTarget) VALUES (?, ?, ?)",
            [userId, 2026, 12],
        );
        const gameId = await game();
        await entry(userId, gameId, {
            status: CollectionEntryStatus.FINISHED,
            finishedAt: new Date("2026-03-01T00:00:00Z"),
        });

        expect(await profiles.getCurrentYearGoal(userId, now)).toEqual({
            year: 2026,
            target: 12,
            finished: 1,
        });
    });

    it("uses the São Paulo calendar year at the New Year boundary", async () => {
        const userId = await user();
        // 2027-01-01T02:30Z is still 2026-12-31 23:30 in São Paulo.
        const now = new Date("2027-01-01T02:30:00Z");
        await source.query(
            `INSERT INTO year_goal (profileUserId, year, finishedGamesTarget) VALUES (?, ?, ?), (?, ?, ?)`,
            [userId, 2026, 12, userId, 2027, 5],
        );

        expect(await profiles.getCurrentYearGoal(userId, now)).toEqual({
            year: 2026,
            target: 12,
            finished: 0,
        });
    });

    it("prioritizes a ready-to-claim contract over an unseen board", async () => {
        const userId = await user();
        const gameId = await game("Relic");
        await profiles.ensureProfile(userId);
        const contractId = await readyContract(userId, gameId);

        const reception = await lina.evaluateReception(
            userId,
            await reload(userId),
            { now: new Date("2026-06-15T12:00:00Z") },
        );

        expect(reception).toMatchObject({
            trigger: LinaTrigger.CONTRACT_READY_TO_CLAIM,
            pose: LinaPose.HAPPY,
            hasUnseenBoard: true,
        });
        expect(reception.context).toEqual({
            contractId,
            category: "library",
            templateKey: "forgotten_relic",
            eventId: null,
            targetGameId: gameId,
            targetGameName: "Relic",
        });
    });

    it("raises the unseen board flag across the Monday rollover until acknowledged", async () => {
        const userId = await user();
        await profiles.ensureProfile(userId);
        const monday = new Date("2026-06-15T12:00:00Z");
        const previousWeek = new Date("2026-06-10T12:00:00Z");
        await source.query(
            "UPDATE guild_profile SET lastBoardSeenAt = ?, lastVisitedAt = ? WHERE profileUserId = ?",
            [previousWeek, monday, userId],
        );

        expect(
            await lina.computeHasUnseenBoard(await reload(userId), monday),
        ).toBe(true);
        const reception = await lina.evaluateReception(
            userId,
            await reload(userId),
            { now: monday },
        );
        expect(reception).toMatchObject({
            trigger: LinaTrigger.WEEKLY_BOARD_REFRESHED,
            hasUnseenBoard: true,
        });
        expect((await reload(userId)).lastBoardSeenAt).toEqual(previousWeek);

        const seen = await profiles.markBoardSeen(userId, monday);
        expect(seen).toEqual({
            hasUnseenBoard: false,
            lastBoardSeenAt: monday,
        });
        expect(
            await lina.computeHasUnseenBoard(await reload(userId), monday),
        ).toBe(false);
    });

    it("raises the unseen board flag when an active curated event is published", async () => {
        const userId = await user();
        await profiles.ensureProfile(userId);
        const seenAt = new Date("2026-06-17T12:00:00Z");
        await profiles.markBoardSeen(userId, seenAt);
        const now = new Date("2026-06-17T14:00:00Z");
        expect(
            await lina.computeHasUnseenBoard(await reload(userId), now),
        ).toBe(false);

        await event(
            new Date("2026-06-17T13:00:00Z"),
            new Date("2026-06-17T00:00:00Z"),
            new Date("2026-06-24T00:00:00Z"),
        );

        expect(
            await lina.computeHasUnseenBoard(await reload(userId), now),
        ).toBe(true);
        await profiles.markBoardSeen(userId, now);
        expect(
            await lina.computeHasUnseenBoard(await reload(userId), now),
        ).toBe(false);
    });

    it("detects 30+ days of inactivity and updates lastVisitedAt after the check", async () => {
        const userId = await user();
        await profiles.ensureProfile(userId);
        const now = new Date("2026-06-15T12:00:00Z");
        await source.query(
            "UPDATE guild_profile SET lastVisitedAt = ?, lastBoardSeenAt = ? WHERE profileUserId = ?",
            [new Date(now.getTime() - 35 * dayMs), now, userId],
        );

        const reception = await lina.evaluateReception(
            userId,
            await reload(userId),
            { now },
        );
        expect(reception).toMatchObject({
            trigger: LinaTrigger.RETURNING_AFTER_INACTIVITY,
            pose: LinaPose.NEUTRAL,
        });
        expect(reception.context).toEqual({ inactiveDays: 35 });
        expect((await reload(userId)).lastVisitedAt).toEqual(now);
        expect((await reload(userId)).lastBoardSeenAt).toEqual(now);

        const immediate = await lina.evaluateReception(
            userId,
            await reload(userId),
            { now: new Date(now.getTime() + 1000) },
        );
        expect(immediate.trigger).not.toBe(
            LinaTrigger.RETURNING_AFTER_INACTIVITY,
        );

        const touchedAt = (await reload(userId)).lastVisitedAt;
        await lina.evaluateReception(userId, await reload(userId), {
            now: new Date(now.getTime() + 2000),
            updateLastVisited: false,
        });
        expect((await reload(userId)).lastVisitedAt).toEqual(touchedAt);
    });

    it("throttles lastVisitedAt writes to once per hour", async () => {
        const userId = await user();
        await profiles.ensureProfile(userId);
        const now = new Date("2026-06-15T12:00:00Z");
        await source.query(
            "UPDATE guild_profile SET lastBoardSeenAt = ? WHERE profileUserId = ?",
            [now, userId],
        );

        await lina.evaluateReception(userId, await reload(userId), { now });
        expect((await reload(userId)).lastVisitedAt).toEqual(now);

        const recent = new Date(now.getTime() - 30 * 60 * 1000);
        await source.query(
            "UPDATE guild_profile SET lastVisitedAt = ? WHERE profileUserId = ?",
            [recent, userId],
        );
        await lina.evaluateReception(userId, await reload(userId), { now });
        expect((await reload(userId)).lastVisitedAt).toEqual(recent);

        const stale = new Date(now.getTime() - 2 * 60 * 60 * 1000);
        await source.query(
            "UPDATE guild_profile SET lastVisitedAt = ? WHERE profileUserId = ?",
            [stale, userId],
        );
        await lina.evaluateReception(userId, await reload(userId), { now });
        expect((await reload(userId)).lastVisitedAt).toEqual(now);
    });

    it("keeps a returning user out of inactivity when platform activity is recent", async () => {
        const userId = await user();
        await profiles.ensureProfile(userId);
        const now = new Date("2026-06-15T12:00:00Z");
        await source.query(
            "UPDATE guild_profile SET lastVisitedAt = ?, lastBoardSeenAt = ? WHERE profileUserId = ?",
            [new Date(now.getTime() - 40 * dayMs), now, userId],
        );
        const gameId = await game();
        await entry(userId, gameId, {
            status: CollectionEntryStatus.FINISHED,
            createdAt: new Date(now.getTime() - dayMs),
            updatedAt: new Date(now.getTime() - dayMs),
            finishedAt: new Date(now.getTime() - dayMs),
        });

        const reception = await lina.evaluateReception(
            userId,
            await reload(userId),
            { now },
        );
        expect(reception.trigger).toBe(LinaTrigger.DEFAULT);
    });

    it("highlights the oldest stale backlog game when the board is seen", async () => {
        const userId = await user();
        await profiles.ensureProfile(userId);
        const now = new Date("2026-06-15T12:00:00Z");
        await source.query(
            "UPDATE guild_profile SET lastBoardSeenAt = ?, lastVisitedAt = ? WHERE profileUserId = ?",
            [now, now, userId],
        );
        const gameId = await game("Lost Relic");
        await entry(userId, gameId, {
            status: CollectionEntryStatus.PLANNED,
            createdAt: new Date("2023-05-01T00:00:00Z"),
            plannedAt: new Date("2023-05-01T00:00:00Z"),
        });

        const reception = await lina.evaluateReception(
            userId,
            await reload(userId),
            { now },
        );
        expect(reception).toMatchObject({
            trigger: LinaTrigger.STALE_BACKLOG_GAME,
            pose: LinaPose.NEUTRAL,
            hasUnseenBoard: false,
        });
        expect(reception.context).toEqual({
            gameId,
            gameName: "Lost Relic",
            sinceYear: 2023,
        });
    });

    it("highlights a dropped stale backlog game", async () => {
        const userId = await user();
        await profiles.ensureProfile(userId);
        const now = new Date("2026-06-15T12:00:00Z");
        await source.query(
            "UPDATE guild_profile SET lastBoardSeenAt = ?, lastVisitedAt = ? WHERE profileUserId = ?",
            [now, now, userId],
        );
        const gameId = await game("Dropped Relic");
        await entry(userId, gameId, {
            status: CollectionEntryStatus.DROPPED,
            createdAt: new Date("2023-05-01T00:00:00Z"),
            plannedAt: new Date("2023-05-01T00:00:00Z"),
        });

        const reception = await lina.evaluateReception(
            userId,
            await reload(userId),
            { now },
        );
        expect(reception).toMatchObject({
            trigger: LinaTrigger.STALE_BACKLOG_GAME,
            pose: LinaPose.NEUTRAL,
            hasUnseenBoard: false,
        });
        expect(reception.context).toEqual({
            gameId,
            gameName: "Dropped Relic",
            sinceYear: 2023,
        });
    });

    it("skips a previously finished dropped game for Lina's stale pick", async () => {
        const userId = await user();
        await profiles.ensureProfile(userId);
        const now = new Date("2026-06-15T12:00:00Z");
        await source.query(
            "UPDATE guild_profile SET lastBoardSeenAt = ?, lastVisitedAt = ? WHERE profileUserId = ?",
            [now, now, userId],
        );
        const finishedDropped = await game("Finished Dropped");
        const stillStale = await game("Still Stale");
        await entry(userId, finishedDropped, {
            status: CollectionEntryStatus.DROPPED,
            createdAt: new Date("2023-04-01T00:00:00Z"),
            plannedAt: new Date("2023-04-01T00:00:00Z"),
        });
        await entry(userId, stillStale, {
            status: CollectionEntryStatus.PLANNED,
            createdAt: new Date("2023-05-01T00:00:00Z"),
            plannedAt: new Date("2023-05-01T00:00:00Z"),
        });
        await finishHistory(
            userId,
            finishedDropped,
            new Date("2023-03-01T00:00:00Z"),
        );

        expect(await lina.findOldestStaleBacklogGame(userId, now)).toEqual({
            gameId: stillStale,
            gameName: "Still Stale",
            sinceYear: 2023,
        });
        const reception = await lina.evaluateReception(
            userId,
            await reload(userId),
            { now },
        );
        expect(reception).toMatchObject({
            trigger: LinaTrigger.STALE_BACKLOG_GAME,
            context: {
                gameId: stillStale,
                gameName: "Still Stale",
                sinceYear: 2023,
            },
        });
    });

    it("falls back to the default reception and ignores recently played backlog", async () => {
        const userId = await user();
        await profiles.ensureProfile(userId);
        const now = new Date("2026-06-15T12:00:00Z");
        await source.query(
            "UPDATE guild_profile SET lastBoardSeenAt = ?, lastVisitedAt = ? WHERE profileUserId = ?",
            [now, now, userId],
        );
        const gameId = await game("Recently Played");
        await entry(userId, gameId, {
            status: CollectionEntryStatus.PLANNED,
            createdAt: new Date("2023-05-01T00:00:00Z"),
            plannedAt: new Date("2023-05-01T00:00:00Z"),
        });
        const platformId = 9_000_001;
        await source.query(
            "INSERT IGNORE INTO game_platform (id, name) VALUES (?, ?)",
            [platformId, "PC"],
        );
        await source.query(
            "INSERT INTO user_playtime (source, profileUserId, gameId, lastPlayedDate, platformId) VALUES ('steam', ?, ?, ?, ?)",
            [userId, gameId, new Date(now.getTime() - dayMs), platformId],
        );

        expect(await lina.findOldestStaleBacklogGame(userId, now)).toBeNull();
        const reception = await lina.evaluateReception(
            userId,
            await reload(userId),
            { now },
        );
        expect(reception).toMatchObject({
            trigger: LinaTrigger.DEFAULT,
            pose: LinaPose.NEUTRAL,
            context: {},
            hasUnseenBoard: false,
        });
    });

    it("exposes Seals, Prestige, perks and equipped Guild cosmetics on the License", async () => {
        const userId = await user();
        await profiles.ensureProfile(userId);
        await source.query(
            `UPDATE guild_profile
             SET xp = ?, sealsBalance = ?, equippedLicenseThemeKey = ?, equippedStampStyleKey = ?, equippedDecorKeys = ?, showcaseBadgeIds = ?
             WHERE profileUserId = ?`,
            [
                10_000,
                275,
                "license_obsidian_ledger",
                "stamp_gold_seal",
                JSON.stringify(["decor_sleeping_cat", "decor_compass_rose"]),
                JSON.stringify(["guild-archaeologist"]),
                userId,
            ],
        );

        const license = await profiles.getLicense(
            userId,
            undefined,
            new Date("2026-06-15T12:00:00Z"),
        );

        expect(license).toMatchObject({
            rank: GuildRank.S,
            sealsBalance: 275,
            prestigeLevel: 1,
            prestigeXpIntoCurrent: 0,
            xpToNextPrestige: 2500,
            perks: {
                maxActiveContracts: 4,
                weeklyRerolls: 2,
                monthlyExpedition: true,
                monthlyExpeditionRankS: true,
                monthlyFreeHourglass: 1,
                legendaryContracts: true,
            },
            equippedLicenseThemeKey: "license_obsidian_ledger",
            equippedStampStyleKey: "stamp_gold_seal",
            equippedDecorKeys: ["decor_sleeping_cat", "decor_compass_rose"],
            showcaseBadgeIds: ["guild-archaeologist"],
        });
    });

    it("adds the Extra Slot Permit to the License cap only during its week", async () => {
        const userId = await user();
        await profiles.ensureProfile(userId);
        const now = new Date("2026-06-17T12:00:00Z");
        await source.query(
            "UPDATE guild_profile SET xp = 1240, extraSlotPermitWeekStart = ? WHERE profileUserId = ?",
            [currentWeekStart(now), userId],
        );

        const license = await profiles.getLicense(userId, undefined, now);
        expect(license.perks.maxActiveContracts).toBe(4);

        const nextWeek = await profiles.getLicense(
            userId,
            undefined,
            new Date("2026-06-24T12:00:00Z"),
        );
        expect(nextWeek.perks.maxActiveContracts).toBe(3);
    });

    it("lazily grants missed Rank promotion packages on the first License read", async () => {
        const userId = await user();
        await profiles.ensureProfile(userId);
        await source.query(
            "UPDATE guild_profile SET xp = 2200, highestPromotedRank = ? WHERE profileUserId = ?",
            [GuildRank.E, userId],
        );

        await profiles.getLicense(userId);
        await profiles.getLicense(userId);

        const [profile] = await source.query(
            "SELECT highestPromotedRank FROM guild_profile WHERE profileUserId = ?",
            [userId],
        );
        expect(profile.highestPromotedRank).toBe(GuildRank.B);

        const unlocks: Array<{ rewardKey: string }> = await source.query(
            `SELECT r.\`key\` AS rewardKey
             FROM user_guild_reward ugr
             INNER JOIN guild_reward r ON r.id = ugr.rewardId
             WHERE ugr.profileUserId = ?
             ORDER BY r.\`key\` ASC`,
            [userId],
        );
        expect(unlocks.map((row) => row.rewardKey)).toEqual(
            [
                ...GUILD_RANK_PROMOTION_REWARDS[GuildRank.D],
                ...GUILD_RANK_PROMOTION_REWARDS[GuildRank.C],
                ...GUILD_RANK_PROMOTION_REWARDS[GuildRank.B],
            ].sort(),
        );
    });

    it("greets Rank C+ members with the refreshed Monthly Expedition in a new month", async () => {
        const userId = await user();
        await profiles.ensureProfile(userId);
        const now = new Date("2026-07-02T12:00:00Z");
        const previousVisit = new Date("2026-06-20T12:00:00Z");
        await source.query(
            "UPDATE guild_profile SET xp = 900, lastBoardSeenAt = ?, lastVisitedAt = ? WHERE profileUserId = ?",
            [now, previousVisit, userId],
        );

        expect(
            await lina.evaluateReception(userId, await reload(userId), { now }),
        ).toMatchObject({
            trigger: LinaTrigger.MONTHLY_EXPEDITION_REFRESHED,
            pose: LinaPose.NEUTRAL,
            context: {},
        });

        // Below Rank C the Monthly Expedition slot stays locked: no greeting.
        await source.query(
            "UPDATE guild_profile SET xp = 500, lastVisitedAt = ? WHERE profileUserId = ?",
            [previousVisit, userId],
        );
        expect(
            (
                await lina.evaluateReception(userId, await reload(userId), {
                    now,
                })
            ).trigger,
        ).toBe(LinaTrigger.DEFAULT);
    });

    it("keeps ready contracts, inactivity and unseen boards above new greetings", async () => {
        const userId = await user();
        await profiles.ensureProfile(userId);
        const now = new Date("2026-07-02T12:00:00Z");
        const previousVisit = new Date("2026-06-20T12:00:00Z");
        await profiles.markBoardSeen(userId, now);
        const gameId = await game("Bounty Ready");
        await readyContract(userId, gameId);

        expect(
            (
                await lina.evaluateReception(userId, await reload(userId), {
                    now,
                    hasClaimableCommunityBounty: true,
                })
            ).trigger,
        ).toBe(LinaTrigger.CONTRACT_READY_TO_CLAIM);

        // Rank C+ visiting in a new month: returning and unseen board still win.
        await source.query(
            "UPDATE guild_profile SET xp = 900, lastVisitedAt = ? WHERE profileUserId = ?",
            [new Date(now.getTime() - 35 * dayMs), userId],
        );
        await source.query(
            "DELETE FROM guild_contract WHERE profileUserId = ?",
            [userId],
        );
        expect(
            (
                await lina.evaluateReception(userId, await reload(userId), {
                    now,
                })
            ).trigger,
        ).toBe(LinaTrigger.RETURNING_AFTER_INACTIVITY);

        await source.query(
            "UPDATE guild_profile SET lastBoardSeenAt = ?, lastVisitedAt = ? WHERE profileUserId = ?",
            [new Date(now.getTime() - 7 * dayMs), previousVisit, userId],
        );
        expect(
            (
                await lina.evaluateReception(userId, await reload(userId), {
                    now,
                })
            ).trigger,
        ).toBe(LinaTrigger.WEEKLY_BOARD_REFRESHED);
    });

    it("prioritizes a claimable Community Bounty over the Monthly Expedition greeting", async () => {
        const userId = await user();
        await profiles.ensureProfile(userId);
        const now = new Date("2026-07-02T12:00:00Z");
        await source.query(
            "UPDATE guild_profile SET xp = 900, lastBoardSeenAt = ?, lastVisitedAt = ? WHERE profileUserId = ?",
            [now, new Date("2026-06-20T12:00:00Z"), userId],
        );

        expect(
            await lina.evaluateReception(userId, await reload(userId), {
                now,
                hasClaimableCommunityBounty: true,
            }),
        ).toMatchObject({
            trigger: LinaTrigger.COMMUNITY_BOUNTY_READY,
            pose: LinaPose.HAPPY,
        });
    });

    it("returns passport, active chain, bounty and License economy on the overview", async () => {
        const userId = await user();
        await profiles.ensureProfile(userId);
        const now = new Date("2026-07-02T12:00:00Z");
        await source.query(
            "UPDATE guild_profile SET xp = 900, sealsBalance = 150, lastBoardSeenAt = ?, lastVisitedAt = ? WHERE profileUserId = ?",
            [now, new Date("2026-06-20T12:00:00Z"), userId],
        );
        await passportMonth(userId, "2026-07", 3);
        await startChainProgress(userId, 1, now);
        await publishedBounty(userId, now);

        const overview = await contracts.getOverview(userId, now);

        expect(overview.license).toMatchObject({
            rank: GuildRank.C,
            sealsBalance: 150,
            prestigeLevel: 0,
            prestigeXpIntoCurrent: 0,
            xpToNextPrestige: 2500,
            perks: { maxActiveContracts: 3 },
        });
        expect(overview.passport).toEqual({
            monthKey: "2026-07",
            completedContractsCount: 3,
            claimableMilestones: [2],
        });
        expect(overview.activeChain).toMatchObject({
            chainKey: "pathfinders_arc",
            status: "in_progress",
            currentStageIndex: 1,
            totalStages: 3,
            boundTargetGameId: null,
            activeContractId: null,
        });
        expect(overview.activeBountiesCount).toBe(1);
        expect(overview.lina).toMatchObject({
            trigger: LinaTrigger.COMMUNITY_BOUNTY_READY,
            pose: LinaPose.HAPPY,
        });
    });
});
