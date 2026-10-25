jest.mock("typeorm-transactional", () => ({
    runInTransaction: (work: () => Promise<unknown>) => work(),
}));
import {
    playerStateFixture,
    playerOwner,
} from "../sync/player-data/player-sync.fixture";
jest.mock("../sync/steam/steam-sync.service", () => ({
    SteamSyncService: class {},
}));
jest.mock("../sync/psn/psn-sync.service", () => ({ PsnSyncService: class {} }));
jest.mock("../sync/xbox/xbox-sync.service", () => ({
    XboxSyncService: class {},
}));
jest.mock("../playtime/watch/playtime-watch.service", () => ({
    PlaytimeWatchService: class {},
}));
jest.mock("../collections/collections.service", () => ({
    CollectionsService: class {},
}));
import { ConnectionsService } from "./connections.service";
import { EConnectionType } from "./connections.constants";

describe("connection onboarding admission", () => {
    it("does not report success when the initial queue write fails", async () => {
        const failure = new Error("Redis unavailable");
        const save = jest
            .fn()
            .mockImplementation(async (connection) => connection);
        const service = new ConnectionsService(
            {
                findOne: jest.fn().mockResolvedValue(null),
                findOneBy: jest.fn().mockResolvedValue(null),
                save,
            } as any,
            {
                resolveUserInfo: jest.fn().mockResolvedValue({
                    userId: "source-user",
                    username: "source-name",
                }),
            } as any,
            {} as any,
            {} as any,
            { registerJob: jest.fn().mockRejectedValue(failure) } as any,
            {} as any,
            playerStateFixture() as any,
        );
        await expect(
            service.createOrUpdate("test-user", {
                type: EConnectionType.STEAM,
                userIdentifier: "source-user",
                isAutoImportEnabled: false,
            } as any),
        ).rejects.toBe(failure);
        expect(save).toHaveBeenCalledTimes(1);
    });
});
