import {
    PlayerSyncStateService,
    PlayerSyncOwner,
    PLAYER_OWNER_LEASE_MS,
} from "./player-sync-state.service";
import {
    EConnectionAuthStatus,
    EConnectionType,
} from "../../connection/connections.constants";
import { ProviderSyncError } from "../provider-sync.error";
import { PlayerConnectionSync } from "./entity/player-connection-sync.entity";
import { PlayerGameSync } from "./entity/player-game-sync.entity";

test("owned work renews its lease and stops the renewal timer on completion", async () => {
    jest.useFakeTimers();
    const service = new PlayerSyncStateService({} as any);
    jest.spyOn(service, "start").mockResolvedValue(undefined);
    const renew = jest.spyOn(service, "renew").mockResolvedValue(undefined);
    const owner: PlayerSyncOwner = {
        connectionId: 1,
        sourceUserId: "account",
        userId: "user",
        source: EConnectionType.STEAM,
        ownerToken: "fixture",
    };
    let finish!: () => void;
    try {
        const pending = service.runOwned(
            owner,
            () =>
                new Promise<void>((resolve) => {
                    finish = resolve;
                }),
        );
        await jest.advanceTimersByTimeAsync(PLAYER_OWNER_LEASE_MS / 3);
        expect(renew).toHaveBeenCalledTimes(1);
        finish();
        await pending;
        expect(jest.getTimerCount()).toBe(0);
    } finally {
        jest.useRealTimers();
    }
});

test("due() query filters out connections with authStatus reauth_required and state outcome reauth_required", async () => {
    const qb: any = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
    };
    const mockRepo = {
        createQueryBuilder: jest.fn().mockReturnValue(qb),
    };
    const mockDataSource = {
        manager: {},
        getRepository: jest.fn().mockReturnValue(mockRepo),
    };

    const service = new PlayerSyncStateService(mockDataSource as any);
    jest.spyOn(service as any, "now").mockResolvedValue(
        new Date("2026-10-25T12:00:00Z"),
    );

    await service.due();

    expect(qb.innerJoin).toHaveBeenCalledWith(
        expect.anything(),
        "connection",
        "connection.id = state.connectionId",
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
        "(connection.authStatus IS NULL OR connection.authStatus != :reauthRequired)",
        { reauthRequired: EConnectionAuthStatus.REAUTH_REQUIRED },
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
        "state.outcome != :reauthOutcome",
        {
            reauthOutcome: "reauth_required",
        },
    );
});

test("finish() records null retryAt when error is reauth_required", async () => {
    const service = new PlayerSyncStateService({} as any);
    const state = new PlayerConnectionSync();
    state.outcome = "complete";
    state.retryAt = new Date("2026-10-25T14:00:00Z");

    const owner: PlayerSyncOwner = {
        connectionId: 1,
        sourceUserId: "account",
        userId: "user",
        source: EConnectionType.XBOX,
        ownerToken: "fixture",
    };

    jest.spyOn(service as any, "ownedTransaction").mockImplementation(
        async (_owner: any, work: any) => {
            await work({}, state, new Date());
        },
    );

    await service.finish(
        owner,
        new ProviderSyncError("reauth_required", "Token revoked"),
    );

    expect(state.outcome).toBe("reauth_required");
    expect(state.retryAt).toBeNull();
});

test("a revoked per-game grant also suppresses full refreshes", async () => {
    const service = new PlayerSyncStateService({} as any);
    const update = jest.fn();
    const state = new PlayerGameSync();
    const owner = {
        connectionId: 1,
        sourceUserId: "account",
    } as PlayerSyncOwner;
    jest.spyOn(service as any, "ownedTransaction").mockImplementation(
        async (_owner: any, work: any) => work({ update }, state, new Date()),
    );
    await service.finish(
        owner,
        new ProviderSyncError("reauth_required", "revoked"),
    );
    expect(update).toHaveBeenCalledWith(
        PlayerConnectionSync,
        { connectionId: 1, sourceUserId: "account" },
        { outcome: "reauth_required", retryAt: null },
    );
    expect(state).toMatchObject({
        outcome: "reauth_required",
        ownerToken: null,
        leaseExpiresAt: null,
        retryAt: null,
    });
});
