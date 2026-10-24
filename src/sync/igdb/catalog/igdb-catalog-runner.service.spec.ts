import { Logger } from "@nestjs/common";
import { IgdbCatalogRunnerService } from "./igdb-catalog-runner.service";
import { IgdbCatalogStateService } from "./igdb-catalog-state.service";
import { IgdbCatalogClient, CatalogDataError } from "./igdb-catalog.client";
import { IgdbCatalogImportService } from "./igdb-catalog-import.service";
import { IgdbLegacyDrainService } from "./igdb-legacy-drain.service";
import { catalogConfig } from "./igdb-catalog.config";

const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
        resolve = r;
    });
    return { promise, resolve };
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function fixture(concurrency = 1) {
    const durable = {
        runId: "fixture",
        ownerToken: "owner",
        ownerGeneration: 1,
        committedId: 0,
        upperId: null as number | null,
        committedGames: 0,
        committedBatches: 0,
        forceReconciliation: true,
        status: "running",
    };
    const budgets = new Map<string, number>();
    const key = (stage: string, id: number | null) => `${stage}:${id}`;
    const state = {
        claimRun: jest.fn(async (run: string) =>
            run === durable.runId ? { ...durable } : null,
        ),
        readStatus: jest.fn(async () => ({ ...durable })),
        setUpperId: jest.fn(async (_owner: unknown, id: number) => {
            durable.upperId = id;
        }),
        readStageAttempts: jest.fn(
            async (_owner: unknown, stage: string, id: number | null) =>
                budgets.get(key(stage, id)) ?? 0,
        ),
        admitStageAttempt: jest.fn(
            async (_owner: unknown, stage: string, id: number | null) => {
                const count = (budgets.get(key(stage, id)) ?? 0) + 1;
                budgets.set(key(stage, id), count);
                return count;
            },
        ),
        finishAttemptStage: jest.fn(
            async (_owner: unknown, stage: string, id: number | null) => {
                budgets.delete(key(stage, id));
            },
        ),
        renewLease: jest.fn().mockResolvedValue(undefined),
        releaseOwnership: jest.fn().mockResolvedValue(undefined),
        recordFailure: jest.fn().mockResolvedValue(undefined),
        pauseRun: jest.fn(async () => {
            durable.status = "paused";
        }),
        commitBatch: jest.fn(
            async (
                _owner: unknown,
                previous: number,
                maximum: number,
                count: number,
            ) => {
                if (durable.committedId !== previous)
                    throw new Error("bad cursor");
                durable.committedId = maximum;
                durable.committedBatches++;
                durable.committedGames += count;
                budgets.clear();
            },
        ),
        completeRun: jest.fn(async () => {
            durable.status = "completed";
        }),
    };
    const pages: Record<number, number[]> = {
        0: [2, 7],
        7: [9],
        9: [22],
        22: [],
    };
    const client = {
        fetchUpperId: jest.fn().mockResolvedValue(22),
        fetchPage: jest.fn(async (after: number) =>
            pages[after].map((id) => ({
                id,
                name: `Game ${id}`,
                slug: `game-${id}`,
            })),
        ),
    };
    const importer = { persist: jest.fn().mockResolvedValue(undefined) };
    const legacy = { isDrained: jest.fn().mockResolvedValue(true) };
    const config = {
        ...catalogConfig({}),
        enabled: true,
        batchSize: 2,
        gameConcurrency: concurrency,
    };
    const runner = new IgdbCatalogRunnerService(
        state as unknown as IgdbCatalogStateService,
        client as unknown as IgdbCatalogClient,
        importer as unknown as IgdbCatalogImportService,
        legacy as unknown as IgdbLegacyDrainService,
        config,
    );
    return {
        runner,
        state,
        client,
        importer,
        legacy,
        durable,
        budgets,
        config,
    };
}

describe("strict catalog page runner", () => {
    let logs: jest.SpyInstance;
    let errors: jest.SpyInstance;
    beforeEach(() => {
        logs = jest
            .spyOn(Logger.prototype, "log")
            .mockImplementation(() => undefined);
        errors = jest
            .spyOn(Logger.prototype, "error")
            .mockImplementation(() => undefined);
    });
    afterEach(() => {
        logs.mockRestore();
        errors.mockRestore();
    });
    it("commits three pages by maximum ID and completes only after an empty page", async () => {
        const f = fixture();
        await f.runner.run("fixture");
        expect(
            f.state.commitBatch.mock.calls.map((call) => call.slice(1)),
        ).toEqual([
            [0, 7, 2],
            [7, 9, 1],
            [9, 22, 1],
        ]);
        expect(f.client.fetchPage.mock.calls.map((call) => call[0])).toEqual([
            0, 7, 9, 22,
        ]);
        expect(f.state.completeRun).toHaveBeenCalledTimes(1);
        expect(f.durable).toMatchObject({
            committedId: 22,
            committedGames: 4,
            committedBatches: 3,
        });
        expect(f.importer.persist.mock.calls[0][0]).toMatchObject({ id: 2 });
    });
    it.each(["game", "statistics", "checkpoint"])(
        "does not fetch ahead of unresolved %s",
        async (dependency) => {
            const f = fixture();
            const gate = deferred();
            if (dependency === "checkpoint") {
                const commit = f.state.commitBatch.getMockImplementation()!;
                f.state.commitBatch.mockImplementationOnce(async (...args) => {
                    await gate.promise;
                    return commit(...args);
                });
            } else
                f.importer.persist.mockImplementationOnce(() => gate.promise);
            const run = f.runner.run("fixture");
            await tick();
            expect(f.client.fetchPage).toHaveBeenCalledTimes(1);
            expect(f.state.completeRun).not.toHaveBeenCalled();
            gate.resolve();
            await run;
            expect(f.client.fetchPage).toHaveBeenCalledTimes(4);
        },
    );
    it("replays from the durable cursor after checkpoint failure without double counting", async () => {
        const f = fixture();
        f.state.commitBatch.mockRejectedValueOnce(
            new CatalogDataError("checkpoint fault"),
        );
        await expect(f.runner.run("fixture")).rejects.toThrow(
            "checkpoint fault",
        );
        expect(f.durable.committedId).toBe(0);
        expect(f.client.fetchPage).toHaveBeenCalledTimes(1);
        f.budgets.clear();
        await f.runner.run("fixture");
        expect(f.client.fetchPage.mock.calls.map((call) => call[0])).toEqual([
            0, 0, 7, 9, 22,
        ]);
        expect(f.durable.committedGames).toBe(4);
    });
    it("stops admission on game failure and waits for already-started work before pause", async () => {
        const f = fixture(2);
        const gate = deferred();
        f.importer.persist
            .mockRejectedValueOnce(new CatalogDataError("invalid game"))
            .mockImplementationOnce(() => gate.promise);
        const run = f.runner.run("fixture");
        const rejected = expect(run).rejects.toThrow("invalid game");
        await tick();
        expect(f.state.pauseRun).not.toHaveBeenCalled();
        expect(f.client.fetchPage).toHaveBeenCalledTimes(1);
        gate.resolve();
        await rejected;
        expect(f.state.pauseRun).toHaveBeenCalledTimes(1);
        expect(f.durable.committedId).toBe(0);
    });
    it("handles an initially empty catalog without deleting local games", async () => {
        const f = fixture();
        f.client.fetchUpperId.mockResolvedValue(0);
        f.client.fetchPage.mockResolvedValue([]);
        await f.runner.run("fixture");
        expect(f.state.commitBatch).not.toHaveBeenCalled();
        expect(f.importer.persist).not.toHaveBeenCalled();
        expect(f.state.completeRun).toHaveBeenCalledTimes(1);
    });
    it("does no work when disabled, stale, or blocked by legacy jobs", async () => {
        const f = fixture();
        f.config.enabled = false;
        await f.runner.run("fixture");
        expect(f.state.claimRun).not.toHaveBeenCalled();
        f.config.enabled = true;
        f.legacy.isDrained.mockResolvedValue(false);
        await f.runner.run("fixture");
        expect(f.client.fetchUpperId).not.toHaveBeenCalled();
        f.legacy.isDrained.mockResolvedValue(true);
        await f.runner.run("stale");
        expect(f.client.fetchPage).not.toHaveBeenCalled();
    });
    it("aborts on heartbeat loss and prohibits a checkpoint after active work settles", async () => {
        jest.useFakeTimers({ doNotFake: ["setImmediate", "nextTick"] });
        const f = fixture();
        const gate = deferred();
        f.importer.persist.mockImplementationOnce(() => gate.promise);
        f.state.renewLease.mockRejectedValueOnce(new Error("lease lost"));
        const running = f.runner.run("fixture");
        try {
            await tick();
            await jest.advanceTimersByTimeAsync(20000);
            expect(f.state.renewLease).toHaveBeenCalledTimes(1);
            gate.resolve();
            await running;
            expect(f.state.commitBatch).not.toHaveBeenCalled();
            expect(f.client.fetchPage).toHaveBeenCalledTimes(1);
            expect(f.state.releaseOwnership).not.toHaveBeenCalled();
        } finally {
            gate.resolve();
            jest.useRealTimers();
        }
    });

    it("releases ownership on shutdown only after active game settlement", async () => {
        const f = fixture();
        const gate = deferred();
        f.importer.persist.mockImplementationOnce(() => gate.promise);
        const running = f.runner.run("fixture");
        await tick();
        const shutdown = f.runner.onModuleDestroy();
        await tick();
        expect(f.state.releaseOwnership).not.toHaveBeenCalled();
        gate.resolve();
        await Promise.all([running, shutdown]);
        expect(f.state.releaseOwnership).toHaveBeenCalledTimes(1);
        expect(f.state.commitBatch).not.toHaveBeenCalled();
    });

    it("retains exhausted game budgets across process recovery until explicit resume", async () => {
        const f = fixture();
        f.budgets.set("game:2", 3);
        await expect(f.runner.run("fixture")).rejects.toThrow(
            "budget exhausted",
        );
        expect(f.importer.persist).not.toHaveBeenCalled();
        expect(f.durable.committedId).toBe(0);
        expect(f.budgets.get("game:2")).toBe(3);
        f.budgets.clear();
        await f.runner.run("fixture");
        expect(f.durable.committedGames).toBe(4);
    });
    it("logs committed counts and identifiers without source payloads or credentials", async () => {
        const f = fixture();
        await f.runner.run("fixture");
        const entries = logs.mock.calls.map((call) => call[0]);
        expect(
            entries
                .filter((entry) => entry.event === "catalog.batch")
                .map((entry) => entry.committedGames),
        ).toEqual([2, 3, 4]);
        expect(
            entries.find((entry) => entry.event === "catalog.completed"),
        ).toMatchObject({ runId: "fixture", cursor: 22, committedGames: 4 });
        const output = JSON.stringify(entries);
        for (const forbidden of [
            "Authorization",
            "access_token",
            "name",
            "slug",
            "Game 2",
        ])
            expect(output).not.toContain(forbidden);
    });
});
