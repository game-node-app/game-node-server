import { DailyRankingService } from "./daily-ranking.service";

const TODAY = "2026-03-04";

const runner = (acquired: number) => ({
    connect: jest.fn().mockResolvedValue(undefined),
    query: jest.fn(async (sql: string) =>
        sql.includes("GET_LOCK") ? [{ acquired }] : [{ released: 1 }],
    ),
    release: jest.fn().mockResolvedValue(undefined),
});

const build = (
    query: jest.Mock,
    lockRunner = runner(1),
    cacheGet = jest.fn().mockResolvedValue(undefined),
) => {
    const dataSource = {
        query,
        createQueryRunner: jest.fn(() => lockRunner),
        manager: {},
    };
    const cache = { get: cacheGet, set: jest.fn().mockResolvedValue(true) };
    return {
        service: new DailyRankingService(
            dataSource as any,
            {} as any,
            cache as any,
            {} as any,
        ),
        dataSource,
        cache,
        lockRunner,
    };
};

describe("DailyRankingService boot duties", () => {
    it("does not rebuild while an all entry exists", async () => {
        const query = jest
            .fn()
            .mockResolvedValue([{ hasEntries: 1, hasResults: 1 }]);
        const { service, dataSource } = build(query);
        const rebuild = jest.spyOn(service, "rebuild").mockResolvedValue(0);

        await service.rebuildIfEmpty(TODAY);

        expect(rebuild).not.toHaveBeenCalled();
        expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
    });

    it("does not rebuild without ranked results", async () => {
        const query = jest
            .fn()
            .mockResolvedValue([{ hasEntries: 0, hasResults: 0 }]);
        const { service } = build(query);
        const rebuild = jest.spyOn(service, "rebuild").mockResolvedValue(0);

        await service.rebuildIfEmpty(TODAY);

        expect(rebuild).not.toHaveBeenCalled();
    });

    it("rebuilds under the named lock on a pinned connection", async () => {
        const query = jest
            .fn()
            .mockResolvedValue([{ hasEntries: 0, hasResults: 1 }]);
        const { service, lockRunner } = build(query);
        const rebuild = jest.spyOn(service, "rebuild").mockResolvedValue(2);

        await service.rebuildIfEmpty(TODAY);

        expect(rebuild).toHaveBeenCalledWith(TODAY);
        expect(lockRunner.connect).toHaveBeenCalledTimes(1);
        expect(lockRunner.query).toHaveBeenNthCalledWith(
            1,
            expect.stringContaining("GET_LOCK"),
            ["daily_ranking_rebuild"],
        );
        expect(lockRunner.query).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining("RELEASE_LOCK"),
            ["daily_ranking_rebuild"],
        );
        expect(lockRunner.release).toHaveBeenCalledTimes(1);
    });

    it("skips the rebuild while another replica holds the lock", async () => {
        const query = jest
            .fn()
            .mockResolvedValue([{ hasEntries: 0, hasResults: 1 }]);
        const lockRunner = runner(0);
        const { service } = build(query, lockRunner);
        const rebuild = jest.spyOn(service, "rebuild").mockResolvedValue(0);

        await service.rebuildIfEmpty(TODAY);

        expect(rebuild).not.toHaveBeenCalled();
        expect(lockRunner.query).toHaveBeenCalledTimes(1);
        expect(lockRunner.release).toHaveBeenCalledTimes(1);
    });

    it("does not snapshot when today's marker exists", async () => {
        const { service, dataSource } = build(
            jest.fn(),
            runner(1),
            jest.fn().mockResolvedValue(true),
        );
        const snapshot = jest.spyOn(service, "snapshot").mockResolvedValue(0);

        await service.snapshotIfNeeded(TODAY);

        expect(snapshot).not.toHaveBeenCalled();
        expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
    });

    it("snapshots under the named lock when the marker is missing", async () => {
        const { service, lockRunner } = build(jest.fn());
        const snapshot = jest.spyOn(service, "snapshot").mockResolvedValue(4);

        await service.snapshotIfNeeded(TODAY);

        expect(snapshot).toHaveBeenCalledWith(TODAY);
        expect(lockRunner.query).toHaveBeenNthCalledWith(
            1,
            expect.stringContaining("GET_LOCK"),
            ["daily_ranking_snapshot"],
        );
        expect(lockRunner.query).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining("RELEASE_LOCK"),
            ["daily_ranking_snapshot"],
        );
        expect(lockRunner.release).toHaveBeenCalledTimes(1);
    });

    it("skips the snapshot while another replica holds the lock", async () => {
        const lockRunner = runner(0);
        const { service } = build(jest.fn(), lockRunner);
        const snapshot = jest.spyOn(service, "snapshot").mockResolvedValue(0);

        await service.snapshotIfNeeded(TODAY);

        expect(snapshot).not.toHaveBeenCalled();
        expect(lockRunner.release).toHaveBeenCalledTimes(1);
    });

    it("releases the lock when the task fails", async () => {
        const { service, lockRunner } = build(
            jest.fn().mockResolvedValue([{ hasEntries: 0, hasResults: 1 }]),
        );
        jest.spyOn(service, "rebuild").mockRejectedValue(new Error("db down"));

        await expect(service.rebuildIfEmpty(TODAY)).rejects.toThrow("db down");

        expect(lockRunner.query).toHaveBeenCalledWith(
            expect.stringContaining("RELEASE_LOCK"),
            ["daily_ranking_rebuild"],
        );
        expect(lockRunner.release).toHaveBeenCalledTimes(1);
    });
});
