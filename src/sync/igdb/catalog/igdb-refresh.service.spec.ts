import { Logger } from "@nestjs/common";
import { IgdbRefreshService } from "./igdb-refresh.service";
import { IGDB_SYNC_ENDPOINTS } from "./igdb-sync-endpoints";
import { catalogConfig } from "./igdb-catalog.config";
import { AsyncLeafLimiter } from "./async-leaf-limiter";
import { QueryFailedError } from "typeorm";
const entry = (endpoint: string) =>
    IGDB_SYNC_ENDPOINTS.find((row) => row.endpoint === endpoint)!;
function fixture(stored: any[] = []) {
    const repo = {
        find: jest.fn().mockResolvedValue(stored),
        findOne: jest.fn().mockResolvedValue(stored[0]),
        existsBy: jest.fn().mockResolvedValue(true),
        update: jest.fn(),
        upsert: jest.fn(),
        metadata: {
            columns: ["id", "name", "checksum", "parentId"].map(
                (propertyName) => ({ propertyName }),
            ),
        },
    };
    const manager = { getRepository: () => repo };
    const source = {
        getRepository: () => repo,
        transaction: async (guard: any) => guard(manager),
    };
    const client = { fetchByIds: jest.fn().mockResolvedValue([]) };
    const importer = { persist: jest.fn() };
    const transactions = {
        gameTransaction: async (guard: any, work: any) => {
            await guard(manager);
            return work(manager);
        },
    };
    const service = new IgdbRefreshService(
        source as any,
        client as any,
        importer as any,
        transactions as any,
        { ...catalogConfig({}), batchSize: 2 },
    );
    const guard = jest.fn();
    const limiter = new AsyncLeafLimiter(2);
    return { service, client, repo, importer, guard, limiter };
}
it("chunks distinct parent games and logs missing parents without writes", async () => {
    const f = fixture();
    const log = jest
        .spyOn(Logger.prototype, "warn")
        .mockImplementation(() => undefined);
    f.client.fetchByIds
        .mockResolvedValueOnce([{ id: 1, name: "One" }])
        .mockResolvedValueOnce([{ id: 3, name: "Three" }]);
    try {
        await f.service.apply(
            entry("covers"),
            [
                { id: 10, game: 1 },
                { id: 11, game: 1 },
                { id: 12, game: 2 },
                { id: 13, game: 3 },
            ],
            f.guard,
            f.limiter,
        );
        expect(f.client.fetchByIds.mock.calls.map((call) => call[1])).toEqual([
            [1, 2],
            [3],
        ]);
        expect(f.importer.persist).toHaveBeenCalledTimes(2);
        expect(log).toHaveBeenCalledWith(
            expect.objectContaining({
                event: "catalog.parent.missing",
                gameId: 2,
            }),
        );
    } finally {
        log.mockRestore();
    }
});
it("uses expanded delta games directly", async () => {
    const f = fixture();
    await f.service.apply(
        entry("games"),
        [{ id: 1, name: "Game" }],
        f.guard,
        f.limiter,
        false,
        true,
    );
    expect(f.client.fetchByIds).not.toHaveBeenCalled();
    expect(f.importer.persist).toHaveBeenCalledTimes(1);
});
it.each(["ER_BAD_NULL_ERROR", "ER_DUP_ENTRY"])(
    "skips non-transient database rejection %s and continues persisting games",
    async (code) => {
        const f = fixture();
        const log = jest
            .spyOn(Logger.prototype, "warn")
            .mockImplementation(() => undefined);
        const failure = new QueryFailedError(
            "UPDATE game",
            [],
            Object.assign(new Error("database rejected row"), { code }),
        );
        f.importer.persist.mockRejectedValueOnce(failure);
        try {
            await f.service.apply(
                entry("games"),
                [
                    { id: 1, name: "Rejected" },
                    { id: 2, name: "Persisted" },
                    { id: 3, name: "Also persisted" },
                ],
                f.guard,
                f.limiter,
                false,
                true,
            );
            expect(f.importer.persist).toHaveBeenCalledTimes(3);
            expect(log).toHaveBeenCalledWith(
                expect.objectContaining({
                    event: "catalog.game.skipped",
                    gameId: 1,
                    reason: failure.message,
                    code,
                }),
            );
        } finally {
            log.mockRestore();
        }
    },
);
it.each([
    {
        label: "deadlock code",
        driverError: Object.assign(new Error("deadlock"), {
            code: "ER_LOCK_DEADLOCK",
        }),
    },
    {
        label: "deadlock errno",
        driverError: Object.assign(new Error("deadlock"), { errno: 1213 }),
    },
])("rethrows transient database rejection: $label", async ({ driverError }) => {
    const f = fixture();
    const failure = new QueryFailedError("UPDATE game", [], driverError);
    f.importer.persist.mockRejectedValueOnce(failure);
    await expect(
        f.service.apply(
            entry("games"),
            [{ id: 1, name: "Game" }],
            f.guard,
            f.limiter,
            false,
            true,
        ),
    ).rejects.toBe(failure);
});
it("rethrows unexpected game persistence errors", async () => {
    const f = fixture();
    const failure = new Error("unexpected persistence error");
    f.importer.persist.mockRejectedValueOnce(failure);
    await expect(
        f.service.apply(
            entry("games"),
            [{ id: 1, name: "Game" }],
            f.guard,
            f.limiter,
            false,
            true,
        ),
    ).rejects.toBe(failure);
});
it("does not insert a shared entity missing locally", async () => {
    const f = fixture();
    await f.service.apply(
        entry("genres"),
        [{ id: 1, name: "Genre" }],
        f.guard,
        f.limiter,
        false,
        true,
    );
    expect(f.repo.update).not.toHaveBeenCalled();
    expect(f.repo.upsert).not.toHaveBeenCalled();
});
it("updates only existing shared rows and fences before writing", async () => {
    const f = fixture([{ id: 1 }]);
    await f.service.apply(
        entry("companies"),
        [{ id: 1, name: "Renamed", parent: 2, logo: { id: 9 } }],
        f.guard,
        f.limiter,
        false,
        true,
    );
    expect(f.repo.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
            name: "Renamed",
            parentId: 2,
            logo: { id: 9 },
        }),
    );
    expect(f.repo.upsert).toHaveBeenCalledWith({ id: 9 }, ["id"]);
    expect(f.importer.persist).not.toHaveBeenCalled();
    f.repo.update.mockClear();
    f.guard.mockRejectedValueOnce(new Error("ownership lost"));
    await expect(
        f.service.apply(
            entry("companies"),
            [{ id: 1 }],
            f.guard,
            f.limiter,
            false,
            true,
        ),
    ).rejects.toThrow("ownership");
    expect(f.repo.update).not.toHaveBeenCalled();
});
it("compares checksum, ownership and a declared reference only when target exists locally", async () => {
    const f = fixture([{ id: 1, checksum: "same", versionParentId: 7 }]);
    const compared = {
        ...entry("games"),
        compare: [
            {
                source: "version_parent",
                column: "versionParentId",
                target: entry("games").local.entity,
            },
        ],
    };
    f.repo.find
        .mockResolvedValueOnce([
            { id: 1, checksum: "same", versionParentId: 7 },
        ])
        .mockResolvedValueOnce([{ id: 9 }]);
    expect(
        await f.service.mismatches(compared, [
            { id: 1, checksum: "same", version_parent: 9 },
        ]),
    ).toHaveLength(1);
    f.repo.find
        .mockResolvedValueOnce([
            { id: 1, checksum: "same", versionParentId: 7 },
        ])
        .mockResolvedValueOnce([]);
    expect(
        await f.service.mismatches(compared, [
            { id: 1, checksum: "same", version_parent: 9 },
        ]),
    ).toEqual([]);
    expect(
        await f.service.mismatches(entry("games"), [
            { id: 1, checksum: "same" },
        ]),
    ).toEqual([]);
});
