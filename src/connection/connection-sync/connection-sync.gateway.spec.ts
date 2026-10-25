jest.mock("../../playtime/watch/playtime-watch.service", () => ({
    PlaytimeWatchService: class {},
}));
jest.mock("../../auth/ws-auth/WsAuthGuard", () => ({ WsAuthGuard: class {} }));
jest.mock("../../utils/ws/WsThrottlerGuard", () => ({
    WsThrottlerGuard: class {},
}));
import { ConnectionSyncGateway } from "./connection-sync.gateway";
import { EConnectionType } from "../connections.constants";

describe("WebSocket synchronization admission", () => {
    it("does not acknowledge a rejected queue write as accepted", async () => {
        const failure = new Error("Redis unavailable");
        const gateway = new ConnectionSyncGateway({
            registerJob: jest.fn().mockRejectedValue(failure),
        } as any);
        await expect(
            gateway.performSync(
                { getUserId: () => "test-user" } as any,
                EConnectionType.STEAM,
            ),
        ).rejects.toBe(failure);
    });
});

test("refresh/status use the authenticated owner and return truthful admission status", async () => {
    const registerJob = jest
        .fn()
        .mockResolvedValue({ status: "cooldown", nextEligibleAt: "fixture" });
    const status = jest
        .fn()
        .mockResolvedValue({ status: "pending", pending: true });
    const gateway = new ConnectionSyncGateway({ registerJob, status } as any);
    const session = { getUserId: () => "authenticated-user" } as any;
    await expect(
        gateway.performSync(session, EConnectionType.STEAM),
    ).resolves.toMatchObject({ status: "cooldown" });
    await expect(
        gateway.status(session, EConnectionType.STEAM),
    ).resolves.toMatchObject({ status: "pending" });
    expect(registerJob).toHaveBeenCalledWith(
        "authenticated-user",
        EConnectionType.STEAM,
    );
    expect(status).toHaveBeenCalledWith(
        "authenticated-user",
        EConnectionType.STEAM,
    );
    await expect(
        gateway.performSync(session, "invalid" as EConnectionType),
    ).rejects.toThrow("Unsupported connection type");
    await expect(
        gateway.status(session, "invalid" as EConnectionType),
    ).rejects.toThrow("Unsupported connection type");
    expect(registerJob).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledTimes(1);
});

test("achievement status uses only the session owner and validates its target", async () => {
    const gameStatus = jest
        .fn()
        .mockResolvedValue({
            status: "unknown",
            outcome: "unknown",
            pending: false,
        });
    const gateway = new ConnectionSyncGateway({ gameStatus } as any);
    const session = { getUserId: () => "owner" } as any;
    expect(
        await gateway.achievementStatus(session, EConnectionType.STEAM, 1),
    ).toMatchObject({ outcome: "unknown" });
    expect(gameStatus).toHaveBeenCalledWith("owner", EConnectionType.STEAM, 1);
    await expect(
        gateway.achievementStatus(session, "invalid" as any, 1),
    ).rejects.toThrow();
    await expect(
        gateway.achievementStatus(session, EConnectionType.STEAM, 0),
    ).rejects.toThrow();
    expect(gameStatus).toHaveBeenCalledTimes(1);
});
