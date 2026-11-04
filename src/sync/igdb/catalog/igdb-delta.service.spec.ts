import { Logger } from "@nestjs/common";
import { IgdbDeltaService } from "./igdb-delta.service";
import { catalogConfig } from "./igdb-catalog.config";
import { CatalogDataError } from "./igdb-catalog.client";
import { CatalogOwnershipLost } from "./igdb-catalog-state.service";
jest.mock("./igdb-sync-endpoints", () => ({
    IGDB_SYNC_ENDPOINTS: [
        { endpoint: "games", delta: true },
        { endpoint: "genres", delta: true },
    ],
}));

function fixture() {
    const owner = { ownerToken: "one", ownerGeneration: 1 };
    const windows = new Map(
        ["games", "genres"].map((stream) => [
            stream,
            {
                cursor: 0,
                watermark: new Date(1000000),
                windowStart: new Date(400000),
                windowEnd: new Date(2000000),
            },
        ]),
    );
    const state = {
        claim: jest.fn().mockResolvedValue(owner),
        assertOwnership: jest.fn(),
        renew: jest.fn(),
        release: jest.fn(),
        pause: jest.fn(),
        window: jest.fn(async (_owner, stream) => ({
            ...windows.get(stream)!,
        })),
        checkpoint: jest.fn(async (_owner, stream, cursor, next) => {
            const window = windows.get(stream)!;
            expect(window.cursor).toBe(cursor);
            if (next === null) window.watermark = window.windowEnd;
            else window.cursor = next;
        }),
    };
    const client = {
        fetchDeltaPage: jest.fn(async (_entry, _start, _end, cursor) =>
            cursor ? [] : [{ id: 42 }],
        ),
    };
    const refresh = { apply: jest.fn() };
    const source = { transaction: jest.fn(async (work) => work({})) };
    const service = new IgdbDeltaService(
        source as any,
        state as any,
        client as any,
        refresh as any,
        catalogConfig({}),
    );
    return { state, client, refresh, service, windows };
}
describe("delta passes", () => {
    let logs: jest.SpyInstance;
    beforeEach(() => {
        logs = jest
            .spyOn(Logger.prototype, "log")
            .mockImplementation(() => undefined);
    });
    afterEach(() => logs.mockRestore());
    it("applies and checkpoints each page before fetching again, logging window and lag", async () => {
        const f = fixture();
        let release!: () => void;
        f.refresh.apply.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    release = resolve;
                }),
        );
        const run = f.service.run();
        await new Promise(setImmediate);
        expect(f.client.fetchDeltaPage).toHaveBeenCalledTimes(1);
        expect(f.state.checkpoint).not.toHaveBeenCalled();
        expect(f.service.run()).toBe(run);
        release();
        await run;
        expect(
            f.state.checkpoint.mock.calls.map((call) => call.slice(1)),
        ).toEqual([
            ["games", 0, 42],
            ["games", 42, null],
            ["genres", 0, 42],
            ["genres", 42, null],
        ]);
        expect(logs.mock.calls.map((call) => call[0])).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    event: "catalog.delta.stream",
                    stream: "games",
                    watermark: new Date(2000000),
                    watermarkLagMs: expect.any(Number),
                    windowStart: new Date(400000),
                    windowEnd: new Date(2000000),
                    entriesApplied: 1,
                    durationMs: expect.any(Number),
                    failureStage: null,
                }),
                expect.objectContaining({
                    event: "catalog.delta.pass",
                    entriesApplied: 2,
                }),
            ]),
        );
    });
    it("isolates stream failures without advancing that watermark", async () => {
        const f = fixture();
        f.refresh.apply.mockRejectedValueOnce(
            new CatalogDataError("bad source"),
        );
        await f.service.run();
        expect(f.state.pause).toHaveBeenCalledWith(
            expect.anything(),
            "games",
            expect.stringContaining("apply:42"),
        );
        expect(f.windows.get("games")!.watermark).toEqual(new Date(1000000));
        expect(f.windows.get("genres")!.watermark).toEqual(new Date(2000000));
    });
    it("resumes a fixed window at the committed cursor", async () => {
        const f = fixture();
        f.windows.get("games")!.cursor = 7;
        await f.service.run();
        expect(f.client.fetchDeltaPage.mock.calls[0].slice(1)).toEqual([
            new Date(400000),
            new Date(2000000),
            7,
            expect.any(AbortSignal),
        ]);
    });
    it("stops before advancing after ownership loss", async () => {
        const f = fixture();
        f.refresh.apply.mockRejectedValueOnce(new CatalogOwnershipLost());
        await expect(f.service.run()).rejects.toThrow("ownership");
        expect(f.state.checkpoint).not.toHaveBeenCalled();
        expect(f.state.pause).not.toHaveBeenCalled();
    });
});
