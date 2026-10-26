import { PlayerDataQueueService } from "./player-data-queue.service";
import { playerOwner, playerStateFixture } from "./player-sync.fixture";
import { EConnectionType } from "../../connection/connections.constants";
import { PLAYER_REFRESH_INTERVAL_MS } from "./player-sync-policy";
import { PlayerSyncStateService } from "./player-sync-state.service";

function fixture() {
    const state = {
        ...playerStateFixture(),
        status: jest
            .fn()
            .mockResolvedValue({ status: "pending", pending: true }),
        bootstrapExisting: jest.fn(),
        due: jest.fn(),
    };
    const queue = { add: jest.fn().mockResolvedValue({ id: "ack" }) };
    return {
        state,
        queue,
        service: new PlayerDataQueueService(
            queue as any,
            state as any,
            { get: () => "true" } as any,
        ),
    };
}

test("initial refresh awaits queue acknowledgement and never reports Redis rejection as accepted", async () => {
    const { state, queue, service } = fixture();
    await expect(
        service.request("user", EConnectionType.STEAM),
    ).resolves.toMatchObject({ status: "accepted" });
    expect(queue.add).toHaveBeenCalledTimes(1);
    const failure = new Error("Redis unavailable");
    queue.add.mockRejectedValue(failure);
    await expect(service.request("user", EConnectionType.STEAM)).rejects.toBe(
        failure,
    );
    state.claim.mockResolvedValue(null as any);
    await expect(
        service.request("user", EConnectionType.STEAM),
    ).resolves.toEqual({ status: "pending", pending: true });
    expect(queue.add).toHaveBeenCalledTimes(2);
});

test("bootstrap is metadata-only and runs once at module initialization", async () => {
    const { state, queue, service } = fixture();
    await service.onModuleInit();
    expect(state.bootstrapExisting).toHaveBeenCalledTimes(1);
    expect(queue.add).not.toHaveBeenCalled();
});

test("the due tick pages 1,001 rows and continues after an enqueue failure", async () => {
    const { state, queue, service } = fixture();
    const at = new Date("2026-10-25T00:00:00Z");
    const rows = Array.from({ length: 1001 }, (_, i) => ({
        connectionId: i + 1,
        sourceUserId: "account",
        nextEligibleAt: at,
    }));
    state.due.mockImplementation(async (cursor) =>
        rows
            .filter((row) => row.connectionId > (cursor?.id ?? 0))
            .slice(0, 100),
    );
    state.claim.mockImplementation(async (id) => ({
        ...playerOwner(`user-${id}`),
        connectionId: id,
    }));
    queue.add.mockImplementation(async (_name, data) => {
        if (data.owner.connectionId === 2)
            throw new Error("fixture rejected admission");
        return { id: "ack" };
    });
    await expect(service.registerDueJobs()).rejects.toThrow(
        "1 player synchronization queue admissions failed",
    );
    expect(queue.add).toHaveBeenCalledTimes(1001);
    expect(new Set(state.claim.mock.calls.map(([id]) => id)).size).toBe(1001);
    expect(state.due.mock.calls[1][0]).toEqual({ at, id: 100 });
    expect(state.due).toHaveBeenCalledTimes(12);
});

test("all sources share a daily successful interval and invalid sources fail before database access", async () => {
    expect(PLAYER_REFRESH_INTERVAL_MS).toBe(86400000);
    const state = new PlayerSyncStateService({} as any);
    await expect(
        state.findConnection("user", "invalid" as EConnectionType),
    ).rejects.toMatchObject({ status: 400 });
});
