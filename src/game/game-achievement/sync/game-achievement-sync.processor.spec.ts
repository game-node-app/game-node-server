import {
    playerStateFixture,
    playerOwner,
} from "../../../sync/player-data/player-sync.fixture";
import { GameAchievementSyncProcessor } from "./game-achievement-sync.processor";
import { GameObtainedAchievementService } from "../game-obtained-achievement.service";
import { EGameExternalGameCategory } from "../../game-repository/game-repository.constants";
import {
    GAME_ACHIEVEMENT_PLAYSTATION_JOB_NAME,
    GAME_ACHIEVEMENT_STEAM_JOB_NAME,
} from "./game-achievement-sync.constants";
import { ProviderSyncError } from "../../../sync/provider-sync.error";
import { UnsupportedGameAchievementSourceError } from "../game-achievement.errors";
import {
    PLAYER_RECONCILE_INTERVAL_MS,
    PLAYER_REFRESH_INTERVAL_MS,
    playerGameSelection,
} from "../../../sync/player-data/player-sync-policy";

function localDataSource(events: string[] = []) {
    const manager = {};
    let transactionActive = false;
    const runner: any = {
        manager,
        connect: jest.fn(),
        query: jest.fn(async (sql: string) =>
            sql.includes("GET_LOCK") ? [{ acquired: 1 }] : [{ released: 1 }],
        ),
        startTransaction: jest.fn(async () => {
            events.push("transaction:start");
            transactionActive = true;
        }),
        commitTransaction: jest.fn(async () => {
            events.push("transaction:commit");
            transactionActive = false;
        }),
        rollbackTransaction: jest.fn(async () => {
            events.push("transaction:rollback");
            transactionActive = false;
        }),
        release: jest.fn(),
        get isTransactionActive() {
            return transactionActive;
        },
    };
    return {
        manager,
        createQueryRunner: jest.fn(() => runner),
    };
}

test("a failed trophy set cannot persist a partial obtained snapshot or update completion", async () => {
    const failure = new Error("Incomplete PSN trophy-detail response");
    const fetch = jest
        .fn()
        .mockResolvedValueOnce([
            { trophyId: 0, earned: true, earnedDateTime: "2026-10-01" },
        ])
        .mockRejectedValueOnce(failure);
    const status = jest.fn();
    const obtained = new GameObtainedAchievementService(
        {} as any,
        {
            findOneByIdOrFail: jest.fn().mockResolvedValue({
                id: 1,
                gameId: 1,
                category: EGameExternalGameCategory.PlaystationStoreUs,
                psnExtraMappings: [
                    { npCommunicationId: "a", npServiceName: "trophy" },
                    { npCommunicationId: "b", npServiceName: "trophy2" },
                ],
            }),
        } as any,
        {} as any,
        { getObtainedAchievements: fetch } as any,
        {} as any,
        {
            findOneByUserIdAndType: jest
                .fn()
                .mockResolvedValue({ sourceUserId: "account" }),
        } as any,
        {} as any,
    );
    const persist = jest.spyOn(obtained, "persistObtainedAchievements");
    const save = jest.fn();
    const processor = new GameAchievementSyncProcessor(
        {
            findAllByExternalGameIdForSync: jest.fn().mockResolvedValue([]),
        } as any,
        obtained,
        { save } as any,
        { updateGameCompletionStatus: status } as any,
        playerStateFixture() as any,
        localDataSource() as any,
    );
    await expect(
        processor.process({
            name: GAME_ACHIEVEMENT_PLAYSTATION_JOB_NAME,
            data: {
                userId: "user",
                externalGameId: 1,
                owner: playerOwner("user", "psn", 1),
            },
        } as any),
    ).rejects.toBe(failure);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(persist).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
});

test("a failed catalogue mapping cannot replace a previous completion", async () => {
    const failure = new ProviderSyncError(
        "incomplete",
        "Incomplete PSN catalogue response",
    );
    const persist = jest.fn();
    const status = jest.fn();
    const saveActivity = jest.fn();
    const processor = new GameAchievementSyncProcessor(
        {
            findAllByExternalGameIdForSync: jest
                .fn()
                .mockRejectedValue(failure),
        } as any,
        {
            fetchObtainedByExternalGameId: jest.fn().mockResolvedValue([
                {
                    externalGameId: 1,
                    gameId: 1,
                    externalId: "trophy-1",
                    isObtained: true,
                    obtainedAt: new Date("2026-10-01T00:00:00Z"),
                    source: EGameExternalGameCategory.PlaystationStoreUs,
                },
            ]),
            persistObtainedAchievements: persist,
        } as any,
        { save: saveActivity, publish: jest.fn() } as any,
        { updateGameCompletionStatus: status } as any,
        playerStateFixture() as any,
        localDataSource() as any,
    );

    await expect(
        processor.process({
            name: GAME_ACHIEVEMENT_PLAYSTATION_JOB_NAME,
            data: {
                userId: "user",
                externalGameId: 1,
                owner: playerOwner("user", "psn", 1),
            },
        } as any),
    ).rejects.toBe(failure);

    expect(persist).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
    expect(saveActivity).not.toHaveBeenCalled();
});

test("successful empty and unsupported results persist without transient retry", async () => {
    const state = playerStateFixture();
    const dataSource = localDataSource();
    const fetchObtainedByExternalGameId = jest
        .fn()
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(
            new ProviderSyncError("unsupported", "No trophy catalogue"),
        )
        .mockRejectedValueOnce(new UnsupportedGameAchievementSourceError());
    const processor = new GameAchievementSyncProcessor(
        {
            findAllByExternalGameIdForSync: jest.fn().mockResolvedValue([]),
        } as any,
        {
            fetchObtainedByExternalGameId,
            persistObtainedAchievements: jest.fn().mockResolvedValue([]),
        } as any,
        { save: jest.fn(), publish: jest.fn() } as any,
        { updateGameCompletionStatus: jest.fn() } as any,
        state as any,
        dataSource as any,
    );
    const owner = playerOwner("user", "psn", 1);
    const job = {
        name: GAME_ACHIEVEMENT_PLAYSTATION_JOB_NAME,
        data: {
            userId: "user",
            externalGameId: 1,
            activityFingerprint: "mapping-version-2",
            owner,
        },
    } as any;

    await processor.process(job);
    expect(state.completeGame).toHaveBeenLastCalledWith(
        owner,
        "empty",
        "mapping-version-2",
        dataSource.manager,
    );

    await expect(processor.process(job)).resolves.toEqual({
        outcome: "unsupported",
    });
    expect(state.completeGame).toHaveBeenLastCalledWith(
        owner,
        "unsupported",
        "mapping-version-2",
    );
    expect(state.finish).not.toHaveBeenCalled();

    await expect(processor.process(job)).resolves.toEqual({
        outcome: "unsupported",
    });
    expect(state.completeGame).toHaveBeenLastCalledWith(
        owner,
        "unsupported",
        "mapping-version-2",
    );
});

test("seven-day reconciliation imports a late achievement without a playtime change", async () => {
    const checkedAt = new Date("2026-10-01T00:00:00Z");
    const now = new Date(checkedAt.getTime() + PLAYER_RECONCILE_INTERVAL_MS);
    const fingerprint = "unchanged-playtime";
    const reason = playerGameSelection(
        {
            checkedAt,
            outcome: "empty",
            activityFingerprint: fingerprint,
            nextEligibleAt: new Date(
                checkedAt.getTime() + PLAYER_REFRESH_INTERVAL_MS,
            ),
            reconcileAt: now,
            retryAt: null,
            leaseExpiresAt: null,
        } as any,
        fingerprint,
        now,
    );
    expect(reason).toBe("reconciliation");

    const state = playerStateFixture();
    const lateAchievement = {
        externalGameId: 1,
        gameId: 1,
        externalId: "late-achievement",
        source: EGameExternalGameCategory.Steam,
        isObtained: true,
        obtainedAt: now,
    };
    const fetchObtainedByExternalGameId = jest
        .fn()
        .mockResolvedValue([lateAchievement]);
    const persistObtainedAchievements = jest
        .fn()
        .mockResolvedValue([{ externalAchievementId: "late-achievement" }]);
    const saveActivity = jest.fn();
    const dataSource = localDataSource();
    const processor = new GameAchievementSyncProcessor(
        {
            findAllByExternalGameIdForSync: jest
                .fn()
                .mockResolvedValue([{ externalId: "late-achievement" }]),
        } as any,
        {
            fetchObtainedByExternalGameId,
            persistObtainedAchievements,
        } as any,
        { save: saveActivity, publish: jest.fn() } as any,
        { updateGameCompletionStatus: jest.fn() } as any,
        state as any,
        dataSource as any,
    );
    const owner = {
        ...playerOwner("user", "steam", 1),
        reason,
    };

    await processor.process({
        name: GAME_ACHIEVEMENT_STEAM_JOB_NAME,
        data: {
            userId: "user",
            externalGameId: 1,
            activityFingerprint: fingerprint,
            owner,
        },
    } as any);

    expect(fetchObtainedByExternalGameId).toHaveBeenCalledWith("user", 1);
    expect(persistObtainedAchievements).toHaveBeenCalledWith(
        "user",
        [lateAchievement],
        dataSource.manager,
    );
    expect(saveActivity).toHaveBeenCalledWith(
        expect.objectContaining({
            totalObtained: 1,
            obtainedGameAchievements: [
                { externalAchievementId: "late-achievement" },
            ],
        }),
        dataSource.manager,
    );
    expect(state.completeGame).toHaveBeenCalledWith(
        owner,
        "complete",
        fingerprint,
        dataSource.manager,
    );
});

test("one obtained and catalogue snapshot feeds persistence, completion, and activity", async () => {
    const state = playerStateFixture();
    const events: string[] = [];
    const obtainedSnapshot = [
        {
            externalGameId: 1,
            gameId: 1,
            externalId: "achievement-1",
            source: EGameExternalGameCategory.Steam,
            isObtained: true,
            obtainedAt: new Date("2026-10-01T00:00:00Z"),
        },
    ];
    const catalogueSnapshot = [
        {
            externalGameId: 1,
            gameId: 1,
            externalId: "achievement-1",
            source: EGameExternalGameCategory.Steam,
        },
    ];
    const persisted = [{ externalAchievementId: "achievement-1" }];
    const fetchObtainedByExternalGameId = jest.fn(async () => {
        events.push("obtained snapshot");
        return obtainedSnapshot;
    });
    const findAllByExternalGameIdForSync = jest.fn(async () => {
        events.push("catalogue snapshot");
        return catalogueSnapshot;
    });
    const persistObtainedAchievements = jest.fn(async () => {
        events.push("obtained rows");
        return persisted;
    });
    const updateGameCompletionStatus = jest.fn(async () => {
        events.push("completion status");
    });
    const dataSource = localDataSource(events);
    const persistedActivity = { id: 10, profileUserId: "user" } as any;
    const saveActivity = jest.fn(async () => {
        events.push("activity");
        return persistedActivity;
    });
    const publishActivity = jest.fn(() => events.push("publish"));
    state.completeGame.mockImplementation(async () => {
        events.push("game state");
    });
    const processor = new GameAchievementSyncProcessor(
        { findAllByExternalGameIdForSync } as any,
        {
            fetchObtainedByExternalGameId,
            persistObtainedAchievements,
        } as any,
        { save: saveActivity, publish: publishActivity } as any,
        { updateGameCompletionStatus } as any,
        state as any,
        dataSource as any,
    );
    const owner = playerOwner("user", "steam", 1);

    await processor.process({
        name: GAME_ACHIEVEMENT_STEAM_JOB_NAME,
        data: { userId: "user", externalGameId: 1, owner },
    } as any);

    expect(fetchObtainedByExternalGameId).toHaveBeenCalledTimes(1);
    expect(fetchObtainedByExternalGameId).toHaveBeenCalledWith("user", 1);
    expect(findAllByExternalGameIdForSync).toHaveBeenCalledTimes(1);
    expect(findAllByExternalGameIdForSync).toHaveBeenCalledWith(1);
    expect(persistObtainedAchievements).toHaveBeenCalledWith(
        "user",
        obtainedSnapshot,
        dataSource.manager,
    );
    expect(updateGameCompletionStatus).toHaveBeenCalledWith(
        "user",
        1,
        catalogueSnapshot,
        obtainedSnapshot,
        dataSource.manager,
    );
    expect(saveActivity).toHaveBeenCalledWith(
        expect.objectContaining({
            totalObtained: 1,
            hasCompletedAllAchievements: true,
            obtainedGameAchievements: persisted,
        }),
        dataSource.manager,
    );
    expect(publishActivity).toHaveBeenCalledWith(persistedActivity);
    expect(events).toEqual([
        "obtained snapshot",
        "catalogue snapshot",
        "transaction:start",
        "obtained rows",
        "completion status",
        "activity",
        "game state",
        "transaction:commit",
        "publish",
    ]);
});

it.each(["obtained rows", "completion status", "activity", "game state"])(
    "does not commit or publish when the %s write fails",
    async (failedWrite) => {
        const events: string[] = [];
        const failure = new Error(`failed ${failedWrite}`);
        const state = playerStateFixture();
        const obtainedSnapshot = [
            {
                externalGameId: 1,
                gameId: 1,
                externalId: "achievement-1",
                source: EGameExternalGameCategory.Steam,
                isObtained: true,
                obtainedAt: new Date("2026-10-01T00:00:00Z"),
            },
        ];
        const catalogueSnapshot = [{ externalId: "achievement-1" }];
        const persisted = [{ externalAchievementId: "achievement-1" }];
        const fetchObtainedByExternalGameId = jest.fn(async () => {
            events.push("obtained snapshot");
            return obtainedSnapshot;
        });
        const findAllByExternalGameIdForSync = jest.fn(async () => {
            events.push("catalogue snapshot");
            return catalogueSnapshot;
        });
        const persistObtainedAchievements = jest.fn(async () => {
            events.push("obtained rows");
            if (failedWrite === "obtained rows") throw failure;
            return persisted;
        });
        const updateGameCompletionStatus = jest.fn(async () => {
            events.push("completion status");
            if (failedWrite === "completion status") throw failure;
        });
        const saveActivity = jest.fn(async () => {
            events.push("activity");
            if (failedWrite === "activity") throw failure;
            return { id: 10, profileUserId: "user" };
        });
        const publishActivity = jest.fn();
        state.completeGame.mockImplementation(async () => {
            events.push("game state");
            if (failedWrite === "game state") throw failure;
        });
        const dataSource = localDataSource(events);
        const processor = new GameAchievementSyncProcessor(
            { findAllByExternalGameIdForSync } as any,
            {
                fetchObtainedByExternalGameId,
                persistObtainedAchievements,
            } as any,
            { save: saveActivity, publish: publishActivity } as any,
            { updateGameCompletionStatus } as any,
            state as any,
            dataSource as any,
        );

        await expect(
            processor.process({
                name: GAME_ACHIEVEMENT_STEAM_JOB_NAME,
                data: {
                    userId: "user",
                    externalGameId: 1,
                    owner: playerOwner("user", "steam", 1),
                },
            } as any),
        ).rejects.toBe(failure);

        expect(dataSource.createQueryRunner).toHaveBeenCalledTimes(1);
        expect(events).toContain("transaction:start");
        expect(events).not.toContain("transaction:commit");
        expect(events.indexOf("obtained snapshot")).toBeLessThan(
            events.indexOf("transaction:start"),
        );
        expect(events.indexOf("catalogue snapshot")).toBeLessThan(
            events.indexOf("transaction:start"),
        );
        expect(publishActivity).not.toHaveBeenCalled();
    },
);

import { randomUUID } from "node:crypto";
import { Queue, Worker } from "bullmq";
const redisDescribe = process.env.PLAYER_IMPORT_TEST_REDIS_PORT
    ? describe
    : describe.skip;
redisDescribe("achievement retry outcomes (real Redis)", () => {
    it.each(["unsupported", "empty", "transient", "failed"])(
        "bounds retries for %s",
        async (outcome) => {
            const prefix = `player-achievement-test-${randomUUID()}`;
            const connection = {
                host: "127.0.0.1",
                port: Number(process.env.PLAYER_IMPORT_TEST_REDIS_PORT),
                maxRetriesPerRequest: null,
            };
            const queue = new Queue("retry-fixture", { prefix, connection });
            let calls = 0;
            const obtained = {
                fetchObtainedByExternalGameId: jest.fn(async () => {
                    calls++;
                    if (outcome === "unsupported")
                        throw new ProviderSyncError("unsupported", "No schema");
                    if (
                        outcome === "failed" ||
                        (outcome === "transient" && calls === 1)
                    )
                        throw new ProviderSyncError(
                            "failed",
                            "Temporary failure",
                        );
                    return [];
                }),
                persistObtainedAchievements: jest.fn().mockResolvedValue([]),
            };
            const dataSource = localDataSource();
            const processor = new GameAchievementSyncProcessor(
                {
                    findAllByExternalGameIdForSync: jest
                        .fn()
                        .mockResolvedValue([]),
                } as any,
                obtained as any,
                { save: jest.fn(), publish: jest.fn() } as any,
                { updateGameCompletionStatus: jest.fn() } as any,
                playerStateFixture() as any,
                dataSource as any,
            );
            const worker = new Worker(
                "retry-fixture",
                (job) => processor.process(job),
                { prefix, connection },
            );
            try {
                await worker.waitUntilReady();
                const finished = new Promise<void>((resolve, reject) => {
                    worker.once("completed", () => resolve());
                    worker.on("failed", (job, error) => {
                        if (job && job.attemptsMade >= 3)
                            outcome === "failed" ? resolve() : reject(error);
                    });
                    worker.once("error", reject);
                });
                const job = await queue.add(
                    GAME_ACHIEVEMENT_PLAYSTATION_JOB_NAME,
                    {
                        userId: "fixture",
                        externalGameId: 1,
                        owner: playerOwner("fixture", "psn", 1),
                    },
                    { attempts: 3, backoff: 1 },
                );
                await finished;
                const stored = await queue.getJob(job.id!);
                expect(await stored!.getState()).toBe(
                    outcome === "failed" ? "failed" : "completed",
                );
                expect(stored!.attemptsMade).toBe(
                    outcome === "failed" ? 3 : outcome === "transient" ? 2 : 1,
                );
                expect(calls).toBe(stored!.attemptsMade);
                if (outcome === "unsupported")
                    expect(
                        obtained.persistObtainedAchievements,
                    ).not.toHaveBeenCalled();
            } finally {
                await worker.close();
                await queue.obliterate();
                await queue.close();
            }
        },
    );
});
