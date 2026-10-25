import {
    PlayerSyncStateService,
    PlayerSyncOwner,
    PLAYER_OWNER_LEASE_MS,
} from "./player-sync-state.service";
import { EConnectionType } from "../../connection/connections.constants";

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
