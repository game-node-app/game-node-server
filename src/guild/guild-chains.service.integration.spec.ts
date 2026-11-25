import "reflect-metadata";
import { randomUUID } from "node:crypto";
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
} from "@nestjs/common";
import { DataSource } from "typeorm";
import { createAwardsTestDatabase } from "../../test/awards/awards-test-database";
import { AchievementsProgressService } from "../achievements/achievements-progress.service";
import { LevelService } from "../level/level.service";
import { UserLevel } from "../level/entities/user-level.entity";
import { PlaytimeHistoryService } from "../playtime/playtime-history.service";
import { UserPlaytimeHistory } from "../playtime/entity/user-playtime-history.entity";
import { Profile } from "../profile/entities/profile.entity";
import { YearGoal } from "../recap/entity/year-goal.entity";
import { RecapGoalsService } from "../recap/recap-goals.service";
import { IgdbPlaytimeSyncService } from "../sync/igdb/playtime/igdb-playtime-sync.service";
import { GameTimeToBeat } from "./entities/game-time-to-beat.entity";
import { GuildContract } from "./entities/guild-contract.entity";
import { GuildProfile } from "./entities/guild-profile.entity";
import { GuildReward } from "./entities/guild-reward.entity";
import { GuildUserChain } from "./entities/guild-user-chain.entity";
import { GuildBoardService } from "./guild-board.service";
import { GuildChainsService } from "./guild-chains.service";
import { GuildContractEvaluatorService } from "./guild-contract-evaluator.service";
import { GuildContractsService } from "./guild-contracts.service";
import { GuildPassportService } from "./guild-passport.service";
import { GuildProfileService } from "./guild-profile.service";
import { GuildRankProgressionService } from "./guild-rank-progression.service";
import { GuildRewardsService } from "./guild-rewards.service";
import { GuildSealsService } from "./guild-seals.service";
import { GuildTimeToBeatService } from "./guild-time-to-beat.service";
import {
    DAY_MS,
    GUILD_CHAIN_FINAL_REWARDS,
    GuildCategory,
    GuildChainStatus,
    GuildContractStatus,
    GuildObjectiveType,
    GuildRank,
    GuildRewardKind,
    GuildRewardRarity,
    GuildSealReason,
    LinaTrigger,
} from "./guild.constants";
import { LinaReceptionService } from "./lina-reception.service";

const NOW = new Date("2026-06-17T12:00:00Z");

const rejectionOf = (promise: Promise<unknown>) =>
    promise.then(
        () => null,
        (error) => error,
    );

const kindForRewardKey = (key: string): GuildRewardKind => {
    if (key.startsWith("frame_")) return GuildRewardKind.AVATAR_FRAME;
    if (key.startsWith("decor_")) return GuildRewardKind.TAVERN_DECOR;
    if (key.startsWith("license_")) return GuildRewardKind.LICENSE_THEME;
    if (key.startsWith("stamp_")) return GuildRewardKind.STAMP_STYLE;
    return GuildRewardKind.TITLE;
};

describe("GuildChainsService (integration)", () => {
    jest.setTimeout(120000);

    const database = `guild_test_chains_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    let db: Awaited<ReturnType<typeof createAwardsTestDatabase>>;
    let source: DataSource;
    let profiles: GuildProfileService;
    let contracts: GuildContractsService;
    let chains: GuildChainsService;
    let evaluator: GuildContractEvaluatorService;
    let nextGameId = 7_400_000;
    let nextPlatformId = 7_500_000;

    beforeAll(async () => {
        db = await createAwardsTestDatabase(database);
        source = db.source;

        const achievements = new AchievementsProgressService(
            source,
            new LevelService(source.getRepository(UserLevel)),
            { register: jest.fn() } as any,
        );
        const levelService = new LevelService(source.getRepository(UserLevel));
        profiles = new GuildProfileService(
            source.getRepository(GuildProfile),
            source.getRepository(Profile),
            source,
            new RecapGoalsService(source.getRepository(YearGoal), source),
        );
        const lina = new LinaReceptionService(source, profiles);
        const timeToBeat = new GuildTimeToBeatService(
            source.getRepository(GameTimeToBeat),
            {
                getTimesToBeat: jest.fn(async () => []),
            } as unknown as IgdbPlaytimeSyncService,
        );
        const board = new GuildBoardService(source, timeToBeat);
        const seals = new GuildSealsService(source);
        const rewards = new GuildRewardsService(source, achievements, seals);
        const progression = new GuildRankProgressionService(source, rewards);
        const passport = new GuildPassportService(
            source,
            rewards,
            seals,
            progression,
            levelService,
        );
        evaluator = new GuildContractEvaluatorService(
            source,
            timeToBeat,
            new PlaytimeHistoryService(
                source.getRepository(UserPlaytimeHistory),
                {} as any,
            ),
        );
        chains = new GuildChainsService(source, seals, timeToBeat);
        contracts = new GuildContractsService(
            source,
            profiles,
            board,
            rewards,
            evaluator,
            lina,
            levelService,
            achievements,
            timeToBeat,
            seals,
            progression,
            passport,
            chains,
        );

        // The test schema is synchronized from entities, so the migration's
        // arc-exclusive cosmetics are recreated here.
        for (const keys of Object.values(GUILD_CHAIN_FINAL_REWARDS)) {
            for (const key of keys) {
                await source.getRepository(GuildReward).save({
                    id: randomUUID(),
                    key,
                    kind: kindForRewardKey(key),
                    achievementId: null,
                    inChestPool: false,
                    chestBonusXp: 0,
                    chestBonusSeals: 0,
                    rarity: GuildRewardRarity.EPIC,
                    consumableKey: null,
                    isActive: true,
                });
            }
        }
    });

    afterAll(async () => {
        await db?.destroy();
    });

    async function user(rank = GuildRank.E, xp = 0) {
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
        await source.query(
            "INSERT INTO guild_profile (profileUserId, xp, `rank`) VALUES (?, ?, ?)",
            [userId, xp, rank],
        );
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

    async function platform() {
        const id = nextPlatformId++;
        await source.query(
            "INSERT IGNORE INTO game_platform (id, name) VALUES (?, ?)",
            [id, "PC"],
        );
        return id;
    }

    async function observation(
        userId: string,
        gameId: number,
        platformId: number,
        totalPlaytimeSeconds: number,
        createdAt: Date,
    ) {
        await source.query(
            `INSERT INTO user_playtime_history
                (source, profileUserId, gameId, totalPlaytimeSeconds, recentPlaytimeSeconds,
                 lastPlayedDate, firstPlayedDate, totalPlayCount, platformId, checksum, createdAt, updatedAt)
             VALUES ('steam', ?, ?, ?, 0, ?, NULL, 1, ?, NULL, ?, ?)`,
            [
                userId,
                gameId,
                totalPlaytimeSeconds,
                createdAt,
                platformId,
                createdAt,
                createdAt,
            ],
        );
    }

    async function insertActiveContract(userId: string) {
        const id = randomUUID();
        await source.query(
            `INSERT INTO guild_contract
                (id, profileUserId, boardEntryId, eventId, category, templateKey, \`rank\`,
                 xpReward, objectiveType, criteria, progressCurrent, progressTarget, status,
                 rewardId, claimPayload, acceptedAt, readyAt, claimedAt, expiresAt)
             VALUES (?, ?, NULL, NULL, ?, 'weekend_sprint', ?, 140, ?, '{}', 0, 1, ?, NULL, NULL, ?, NULL, NULL, NULL)`,
            [
                id,
                userId,
                GuildCategory.WEEKLY,
                GuildRank.E,
                GuildObjectiveType.FINISH_GAME,
                GuildContractStatus.ACTIVE,
                NOW,
            ],
        );
        return id;
    }

    const markReady = (contractId: string) =>
        source.query(
            "UPDATE guild_contract SET status = ?, progressCurrent = progressTarget, readyAt = ? WHERE id = ?",
            [GuildContractStatus.READY_TO_CLAIM, NOW, contractId],
        );

    const chainOf = (userId: string, chainKey: string) =>
        source
            .getRepository(GuildUserChain)
            .findOneByOrFail({ profileUserId: userId, chainKey });

    const contractOf = (contractId: string) =>
        source.getRepository(GuildContract).findOneByOrFail({ id: contractId });

    it("lists rank locks and active progress", async () => {
        const userId = await user(GuildRank.D, 800);
        const target = await game("Celeste");
        await chains.startChain(
            userId,
            "pathfinders_arc",
            { targetGameId: target },
            NOW,
        );

        const listed = await chains.listChains(userId, NOW);
        const byKey = new Map(
            listed.chains.map((chain) => [chain.chainKey, chain]),
        );
        expect(byKey.get("pathfinders_arc")).toMatchObject({
            status: "in_progress",
            currentStageIndex: 0,
            boundTargetGameId: target,
            totalStages: 3,
        });
        expect(byKey.get("pathfinders_arc")!.boundGame).toMatchObject({
            gameId: target,
            name: "Celeste",
        });
        expect(byKey.get("curators_arc")!.status).toBe("available");
        expect(byKey.get("relic_hunters_arc")!.status).toBe("locked");
        expect(
            byKey
                .get("pathfinders_arc")!
                .finalRewards.map((reward) => reward.key),
        ).toEqual(
            expect.arrayContaining(["title_pathfinder", "decor_compass_rose"]),
        );
    });

    it("starts Stage 1 bound to the target game and rejects a second start", async () => {
        const userId = await user();
        const target = await game();

        const started = await chains.startChain(
            userId,
            "pathfinders_arc",
            { targetGameId: target },
            NOW,
        );
        expect(started.chain.boundTargetGameId).toBe(target);
        expect(started.chain.activeContractId).toBe(started.contractId);

        const contract = await contractOf(started.contractId);
        expect(contract.targetGameId).toBe(target);
        expect(contract.chainProgressId).toBe(
            (await chainOf(userId, "pathfinders_arc")).id,
        );
        expect(contract.objectiveType).toBe(GuildObjectiveType.LOG_PLAYTIME);
        expect(contract.progressTarget).toBe(120);
        expect(contract.status).toBe(GuildContractStatus.ACTIVE);

        const duplicate = await rejectionOf(
            chains.startChain(
                userId,
                "pathfinders_arc",
                { targetGameId: target },
                NOW,
            ),
        );
        expect(duplicate).toBeInstanceOf(ConflictException);
        expect((duplicate.getResponse() as { code?: string }).code).toBe(
            "guild_chain_already_started",
        );

        const runningStage = await rejectionOf(
            chains.advanceChain(userId, "pathfinders_arc", {}, NOW),
        );
        expect(runningStage).toBeInstanceOf(ConflictException);
        expect((runningStage.getResponse() as { code?: string }).code).toBe(
            "guild_chain_stage_active",
        );
    });

    it("enforces rank locks, required targets and completed-chain restarts", async () => {
        const lowRank = await user(GuildRank.E, 0);
        const rankError = await rejectionOf(
            chains.startChain(lowRank, "curators_arc", {}, NOW),
        );
        expect(rankError).toBeInstanceOf(ForbiddenException);
        expect((rankError.getResponse() as { code?: string }).code).toBe(
            "guild_chain_rank_required",
        );

        const missingTarget = await rejectionOf(
            chains.startChain(lowRank, "pathfinders_arc", {}, NOW),
        );
        expect(missingTarget).toBeInstanceOf(BadRequestException);

        const completedUser = await user(GuildRank.C, 1_000);
        await chains.startChain(completedUser, "relic_hunters_arc", {}, NOW);
        await source.query(
            "UPDATE guild_user_chain SET status = ? WHERE profileUserId = ? AND chainKey = ?",
            [GuildChainStatus.COMPLETED, completedUser, "relic_hunters_arc"],
        );
        const completed = await rejectionOf(
            chains.startChain(completedUser, "relic_hunters_arc", {}, NOW),
        );
        expect(completed).toBeInstanceOf(ConflictException);
        expect((completed.getResponse() as { code?: string }).code).toBe(
            "guild_chain_already_completed",
        );
    });

    it("enforces the dynamic active contract cap on chain start", async () => {
        const userId = await user();
        await insertActiveContract(userId);
        await insertActiveContract(userId);
        await insertActiveContract(userId);
        const target = await game();

        const error = await rejectionOf(
            chains.startChain(
                userId,
                "pathfinders_arc",
                { targetGameId: target },
                NOW,
            ),
        );
        expect(error).toBeInstanceOf(ConflictException);
        expect((error.getResponse() as { code?: string }).code).toBe(
            "guild_active_contract_limit_reached",
        );
    });

    it("inherits the bound game across stages and retries an abandoned stage", async () => {
        const userId = await user();
        const target = await game("Hollow Knight");
        const started = await chains.startChain(
            userId,
            "pathfinders_arc",
            { targetGameId: target },
            NOW,
        );
        const chain = await chainOf(userId, "pathfinders_arc");

        // Stage 1 -> Stage 2.
        await markReady(started.contractId);
        const stageOneClaim = await contracts.claimContract(
            userId,
            started.contractId,
            NOW,
        );
        expect(stageOneClaim.chainProgress).toMatchObject({
            chainKey: "pathfinders_arc",
            currentStageIndex: 1,
            chainCompleted: false,
        });

        const advanced = await chains.advanceChain(
            userId,
            "pathfinders_arc",
            {},
            NOW,
        );
        const stageTwo = await contractOf(advanced.contractId);
        expect(stageTwo.targetGameId).toBe(target);
        expect(stageTwo.objectiveType).toBe(GuildObjectiveType.FINISH_GAME);
        expect(
            (await chainOf(userId, "pathfinders_arc")).currentStageIndex,
        ).toBe(1);

        // Abandoning Stage 2 keeps the chain on Stage 2 and retries it.
        await contracts.abandonContract(userId, advanced.contractId);
        const retried = await chains.advanceChain(
            userId,
            "pathfinders_arc",
            {},
            NOW,
        );
        expect(retried.contractId).not.toBe(advanced.contractId);
        const retriedContract = await contractOf(retried.contractId);
        expect(retriedContract.targetGameId).toBe(target);
        expect(
            (await chainOf(userId, "pathfinders_arc")).currentStageIndex,
        ).toBe(1);
        expect((await chainOf(userId, "pathfinders_arc")).id).toBe(chain.id);

        // Stage 2 -> Stage 3 still inherits the bound game.
        await markReady(retried.contractId);
        await contracts.claimContract(userId, retried.contractId, NOW);
        const stageThree = await chains.advanceChain(
            userId,
            "pathfinders_arc",
            {},
            NOW,
        );
        expect((await contractOf(stageThree.contractId)).targetGameId).toBe(
            target,
        );
    });

    it("completes Stage 3 with exclusive cosmetics, bonus Seals and chain_completed", async () => {
        const userId = await user();
        const target = await game();
        const started = await chains.startChain(
            userId,
            "pathfinders_arc",
            { targetGameId: target },
            NOW,
        );

        await markReady(started.contractId);
        await contracts.claimContract(userId, started.contractId, NOW);
        const stageTwo = await chains.advanceChain(
            userId,
            "pathfinders_arc",
            {},
            NOW,
        );
        await markReady(stageTwo.contractId);
        await contracts.claimContract(userId, stageTwo.contractId, NOW);
        const stageThree = await chains.advanceChain(
            userId,
            "pathfinders_arc",
            {},
            NOW,
        );
        await markReady(stageThree.contractId);

        const claim = await contracts.claimContract(
            userId,
            stageThree.contractId,
            NOW,
        );
        expect(claim.lina.trigger).toBe(LinaTrigger.CHAIN_COMPLETED);
        expect(claim.chainProgress).toMatchObject({
            chainKey: "pathfinders_arc",
            status: GuildChainStatus.COMPLETED,
            chainCompleted: true,
            bonusSealsAwarded: 100,
        });
        expect(
            claim.chainProgress!.finalRewards.map((reward) => reward.key),
        ).toEqual(
            expect.arrayContaining(["title_pathfinder", "decor_compass_rose"]),
        );

        const completed = await chainOf(userId, "pathfinders_arc");
        expect(completed.status).toBe(GuildChainStatus.COMPLETED);
        expect(completed.activeContractId).toBeNull();
        expect(completed.completedAt).not.toBeNull();

        const unlocked: Array<{ key: string }> = await source.query(
            `SELECT gr.key FROM user_guild_reward ugr
             INNER JOIN guild_reward gr ON gr.id = ugr.rewardId
             WHERE ugr.profileUserId = ? ORDER BY gr.key`,
            [userId],
        );
        expect(unlocked.map((row) => row.key)).toEqual(
            expect.arrayContaining(["title_pathfinder", "decor_compass_rose"]),
        );

        const ledger: Array<{ reason: string; delta: number }> =
            await source.query(
                "SELECT reason, delta FROM guild_seal_ledger WHERE profileUserId = ? AND referenceId = ?",
                [userId, stageThree.contractId],
            );
        expect(ledger).toEqual(
            expect.arrayContaining([
                {
                    reason: GuildSealReason.CHAIN_COMPLETE,
                    delta: claim.chainProgress!.bonusSealsAwarded,
                },
            ]),
        );

        expect(await chains.getActiveChainSummary(userId)).toBeNull();
        const advanceAfterCompletion = await rejectionOf(
            chains.advanceChain(userId, "pathfinders_arc", {}, NOW),
        );
        expect(advanceAfterCompletion).toBeInstanceOf(ConflictException);
        expect(
            (advanceAfterCompletion.getResponse() as { code?: string }).code,
        ).toBe("guild_chain_already_completed");
    });

    it("exposes a lightweight active chain summary", async () => {
        const userId = await user(GuildRank.C, 1_000);
        const target = await game();
        const started = await chains.startChain(
            userId,
            "pathfinders_arc",
            { targetGameId: target },
            NOW,
        );

        expect(await chains.getActiveChainSummary(userId)).toMatchObject({
            chainKey: "pathfinders_arc",
            status: GuildChainStatus.IN_PROGRESS,
            currentStageIndex: 0,
            totalStages: 3,
            boundTargetGameId: target,
            activeContractId: started.contractId,
        });
    });

    it("completes Stage 1 from playtime on the bound game", async () => {
        const userId = await user();
        const target = await game("Celeste");
        const platformId = await platform();
        await observation(
            userId,
            target,
            platformId,
            1_000,
            new Date(NOW.getTime() - 60 * 60_000),
        );

        const started = await chains.startChain(
            userId,
            "pathfinders_arc",
            { targetGameId: target },
            NOW,
        );
        // +7,200s (120 minutes) after acceptance.
        await observation(
            userId,
            target,
            platformId,
            8_200,
            new Date(NOW.getTime() + 60_000),
        );
        await evaluator.evaluateUserContracts(
            userId,
            new Date(NOW.getTime() + 120_000),
        );

        const ready = await contractOf(started.contractId);
        expect(ready.status).toBe(GuildContractStatus.READY_TO_CLAIM);
        expect(ready.progressCurrent).toBe(120);
    });

    it("clears the active chain contract when a stage is abandoned", async () => {
        const userId = await user();
        const target = await game();
        const started = await chains.startChain(
            userId,
            "pathfinders_arc",
            { targetGameId: target },
            NOW,
        );

        await contracts.abandonContract(userId, started.contractId);

        const chain = (await chains.listChains(userId, NOW)).chains.find(
            (item) => item.chainKey === "pathfinders_arc",
        )!;
        expect(chain.currentStageIndex).toBe(0);
        expect(chain.activeContractId).toBeNull();
        expect(
            (await chains.getActiveChainSummary(userId))?.activeContractId,
        ).toBeNull();

        const retried = await chains.advanceChain(
            userId,
            "pathfinders_arc",
            {},
            NOW,
        );
        expect(retried.contractId).not.toBe(started.contractId);
        const progress = await chainOf(userId, "pathfinders_arc");
        expect(progress.currentStageIndex).toBe(0);
        expect(progress.activeContractId).toBe(retried.contractId);
    });

    it("clears the active chain contract when a stage expires", async () => {
        const userId = await user();
        const target = await game();
        const started = await chains.startChain(
            userId,
            "pathfinders_arc",
            { targetGameId: target },
            NOW,
        );
        const expiredAt = new Date(NOW.getTime() + 22 * DAY_MS);

        await evaluator.expireOverdueContracts(userId, expiredAt);

        expect((await contractOf(started.contractId)).status).toBe(
            GuildContractStatus.EXPIRED,
        );
        const chain = (await chains.listChains(userId, expiredAt)).chains.find(
            (item) => item.chainKey === "pathfinders_arc",
        )!;
        expect(chain.currentStageIndex).toBe(0);
        expect(chain.activeContractId).toBeNull();
        expect(
            (await chains.getActiveChainSummary(userId))?.activeContractId,
        ).toBeNull();

        const retried = await chains.advanceChain(
            userId,
            "pathfinders_arc",
            {},
            expiredAt,
        );
        const progress = await chainOf(userId, "pathfinders_arc");
        expect(progress.currentStageIndex).toBe(0);
        expect(progress.activeContractId).toBe(retried.contractId);
    });
});
