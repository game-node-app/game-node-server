import {
    playerStateFixture,
    playerOwner,
} from "../../../sync/player-data/player-sync.fixture";
import { GameAchievementSyncQueueService } from "./game-achievement-sync-queue.service";
import { EConnectionType } from "../../../connection/connections.constants";
import {
    GAME_ACHIEVEMENT_PLAYSTATION_JOB_NAME,
    GAME_ACHIEVEMENT_STEAM_JOB_NAME,
    GAME_ACHIEVEMENT_XBOX_JOB_NAME,
} from "./game-achievement-sync.constants";

describe("achievement queue admission", () => {
    it("does not schedule account-specific jobs on repeated construction", () => {
        const add = jest.fn();
        new GameAchievementSyncQueueService(
            { add } as any,
            playerStateFixture() as any,
        );
        new GameAchievementSyncQueueService(
            { add } as any,
            playerStateFixture() as any,
        );
        expect(add).not.toHaveBeenCalled();
    });

    it.each([EConnectionType.STEAM, EConnectionType.PSN, EConnectionType.XBOX])(
        "propagates rejected Redis writes for %s",
        async (source) => {
            const failure = new Error("Redis unavailable");
            const service = new GameAchievementSyncQueueService(
                {
                    add: jest.fn().mockRejectedValue(failure),
                } as any,
                playerStateFixture() as any,
            );
            await expect(
                service.addUserSyncJob("test-user", 1, source),
            ).rejects.toBe(failure);
        },
    );

    it("adds a job only after per-game selection admits an owner", async () => {
        const queue = { add: jest.fn() };
        const state = playerStateFixture();
        const owner = {
            ...playerOwner("test-user", EConnectionType.STEAM, 1),
            reason: "reconciliation" as const,
        };
        state.claim
            .mockResolvedValueOnce(null as any)
            .mockResolvedValueOnce(owner);
        const service = new GameAchievementSyncQueueService(
            queue as any,
            state as any,
        );

        await service.addUserSyncJob(
            "test-user",
            1,
            EConnectionType.STEAM,
            "same-activity",
        );
        expect(queue.add).not.toHaveBeenCalled();

        await service.addUserSyncJob(
            "test-user",
            1,
            EConnectionType.STEAM,
            "same-activity",
        );
        expect(queue.add).toHaveBeenCalledTimes(1);
        expect(queue.add.mock.calls[0][1]).toMatchObject({
            activityFingerprint: "same-activity",
            owner: { reason: "reconciliation" },
        });
    });

    it("keeps provider/game identities distinct in compact jobs", async () => {
        const sources = [
            EConnectionType.STEAM,
            EConnectionType.PSN,
            EConnectionType.XBOX,
        ];
        const ids = new Map(
            sources.map((source, index) => [source, index + 1]),
        );
        const state = {
            findConnection: jest.fn(async (userId, source) => ({
                id: ids.get(source),
                profileUserId: userId,
                sourceUserId: `account-${source}`,
                type: source,
            })),
            claim: jest.fn(
                async (connectionId, sourceUserId, externalGameId) => ({
                    connectionId,
                    sourceUserId,
                    userId: "test-user",
                    source: sources[connectionId - 1],
                    ownerToken: `owner-${connectionId}-${externalGameId}`,
                    externalGameId,
                    reason: "activity" as const,
                }),
            ),
            enqueue: jest.fn((owner, queue, name, data) =>
                queue.add(
                    name,
                    { ...data, owner },
                    { jobId: `player-sync-${owner.ownerToken}` },
                ),
            ),
        };
        const queue = { add: jest.fn().mockResolvedValue(undefined) };
        const service = new GameAchievementSyncQueueService(
            queue as any,
            state as any,
        );

        await service.addUserSyncJob(
            "test-user",
            101,
            EConnectionType.STEAM,
            "a",
        );
        await service.addUserSyncJob(
            "test-user",
            102,
            EConnectionType.STEAM,
            "b",
        );
        await service.addUserSyncJob(
            "test-user",
            201,
            EConnectionType.PSN,
            "c",
        );
        await service.addUserSyncJob(
            "test-user",
            301,
            EConnectionType.XBOX,
            "d",
        );

        expect(queue.add.mock.calls.map(([name]) => name)).toEqual([
            GAME_ACHIEVEMENT_STEAM_JOB_NAME,
            GAME_ACHIEVEMENT_STEAM_JOB_NAME,
            GAME_ACHIEVEMENT_PLAYSTATION_JOB_NAME,
            GAME_ACHIEVEMENT_XBOX_JOB_NAME,
        ]);
        expect(
            queue.add.mock.calls.map(([, data]) => [
                data.externalGameId,
                data.owner.connectionId,
                data.owner.source,
                data.owner.reason,
            ]),
        ).toEqual([
            [101, 1, EConnectionType.STEAM, "activity"],
            [102, 1, EConnectionType.STEAM, "activity"],
            [201, 2, EConnectionType.PSN, "activity"],
            [301, 3, EConnectionType.XBOX, "activity"],
        ]);
        for (const [, data] of queue.add.mock.calls)
            expect(Object.keys(data).sort()).toEqual([
                "activityFingerprint",
                "externalGameId",
                "owner",
                "userId",
            ]);
    });
});

test("a 1,001-game library selects only five changed games on its second eligible run", async () => {
    const {
        playerGameSelection,
        PLAYER_REFRESH_INTERVAL_MS,
        PLAYER_RECONCILE_INTERVAL_MS,
    } = require("../../../sync/player-data/player-sync-policy");
    const { Logger } = require("@nestjs/common");
    const logging = jest
        .spyOn(Logger.prototype, "log")
        .mockImplementation(() => undefined);
    const games = new Map<number, any>();
    let now = new Date("2026-10-25T00:00:00Z");
    let pendingFingerprint = "";
    const queue = { add: jest.fn() };
    const state = {
        findConnection: jest
            .fn()
            .mockResolvedValue({ id: 1, sourceUserId: "account" }),
        claim: jest.fn(async (_id, _account, gameId, fingerprint) => {
            const reason = playerGameSelection(
                games.get(gameId),
                fingerprint,
                now,
            );
            pendingFingerprint = fingerprint;
            return reason ? { externalGameId: gameId, reason } : null;
        }),
        enqueue: jest.fn(async (owner, queue, name, payload) => {
            await queue.add(name, payload);
            games.set(owner.externalGameId, {
                checkedAt: now,
                outcome: "complete",
                activityFingerprint: pendingFingerprint,
                nextEligibleAt: new Date(
                    now.getTime() + PLAYER_REFRESH_INTERVAL_MS,
                ),
                reconcileAt: new Date(
                    now.getTime() + PLAYER_RECONCILE_INTERVAL_MS,
                ),
            });
        }),
    };
    const service = new GameAchievementSyncQueueService(
        queue as any,
        state as any,
    );
    try {
        for (let id = 1; id <= 1001; id++)
            await service.addUserSyncJob(
                "user",
                id,
                EConnectionType.STEAM,
                "100:0",
            );
        expect(queue.add).toHaveBeenCalledTimes(1001);
        queue.add.mockClear();
        state.claim.mockClear();
        now = new Date(now.getTime() + PLAYER_REFRESH_INTERVAL_MS);
        for (let id = 1; id <= 1001; id++)
            await service.addUserSyncJob(
                "user",
                id,
                EConnectionType.STEAM,
                id <= 5 ? "110:10" : "100:0",
            );
        expect(queue.add).toHaveBeenCalledTimes(5);
        expect(state.claim).toHaveBeenCalledTimes(1001);
        expect(games.size).toBe(1001);
        expect(
            [...games.values()].filter(
                (game) => game.activityFingerprint === "110:10",
            ),
        ).toHaveLength(5);
    } finally {
        logging.mockRestore();
    }
});
