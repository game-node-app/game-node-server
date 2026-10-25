import { PlayerDataProcessor } from "./player-data.processor";
import { PLAYER_DATA_JOB } from "./player-data.constants";
import { playerOwner, playerStateFixture } from "./player-sync.fixture";
import { PlayerSyncOwnershipLost } from "./player-sync-state.service";
import { SteamSyncService } from "../steam/steam-sync.service";

function fixture() {
    const state = playerStateFixture();
    const playtime = {
        updateSteamPlaytimeInfo: jest
            .fn()
            .mockResolvedValue({ outcome: "complete" }),
        updatePsnPlaytimeInfo: jest
            .fn()
            .mockResolvedValue({ outcome: "complete" }),
        updateXboxPlaytimeInfo: jest
            .fn()
            .mockResolvedValue({ outcome: "complete" }),
    };
    const importer = { run: jest.fn().mockResolvedValue("empty") };
    const processor = new PlayerDataProcessor(
        state as any,
        playtime as any,
        importer as any,
    );
    const job = {
        name: PLAYER_DATA_JOB,
        data: { userId: "user", source: "steam", owner: playerOwner("user") },
        opts: { attempts: 2 },
        attemptsMade: 0,
    } as any;
    return { state, playtime, importer, processor, job };
}

test("an obsolete owner skips before either stage or provider access", async () => {
    const { state, playtime, importer, processor, job } = fixture();
    state.runOwned.mockRejectedValue(new PlayerSyncOwnershipLost());
    await expect(processor.process(job)).resolves.toEqual({
        outcome: "stale-skip",
    });
    expect(playtime.updateSteamPlaytimeInfo).not.toHaveBeenCalled();
    expect(importer.run).not.toHaveBeenCalled();
});

test("stages reuse one complete library and a failed stage retries independently", async () => {
    const { state, playtime, importer, processor, job } = fixture();
    const owned = jest.fn().mockResolvedValue([{ game: { id: 1 } }]);
    const recent = jest.fn().mockResolvedValue([]);
    const steam: SteamSyncService = Object.assign(
        Object.create(SteamSyncService.prototype),
        { getAllGames: owned, getRecentlyPlayedGames: recent },
    );
    let failed = false;
    playtime.updateSteamPlaytimeInfo.mockImplementation(async () => {
        await steam.getLibraryGames("account");
        if (!failed) {
            failed = true;
            throw new Error("fixture persistence failure");
        }
        return { outcome: "complete" };
    });
    importer.run.mockImplementation(async () => {
        await steam.getLibraryGames("account");
        return "empty";
    });
    state.dueStages
        .mockResolvedValueOnce(["playtime", "discovery"])
        .mockResolvedValueOnce(["playtime"]);
    await expect(processor.process(job)).rejects.toMatchObject({
        outcome: "failed",
    });
    expect(owned).toHaveBeenCalledTimes(1);
    expect(recent).toHaveBeenCalledTimes(1);
    expect(state.completeStage).toHaveBeenCalledWith(
        job.data.owner,
        "discovery",
        "empty",
    );
    expect(state.failStage).toHaveBeenCalledTimes(1);
    job.attemptsMade = 1;
    await expect(processor.process(job)).resolves.toMatchObject({
        outcome: "complete",
    });
    expect(importer.run).toHaveBeenCalledTimes(1);
    expect(state.finish).toHaveBeenCalledTimes(1);
});
