import { ConnectionProviderRegistry } from "./connection-provider.registry";
import { ConnectionsSummaryService } from "./connections-summary.service";
import { EConnectionType } from "./connections.constants";
import { ConnectionsController } from "./connections.controller";
import { ImporterService } from "../importer/importer.service";
import { EImporterSource } from "../importer/importer.constants";

const connection = (id: number, type: EConnectionType) =>
    ({
        id,
        type,
        sourceUserId: `account-${id}`,
        profileUserId: "owner",
        authStatus: "connected",
    }) as any;

test("owner summaries share a library read, deduplicate games and isolate provider failures", async () => {
    const registry = new ConnectionProviderRegistry();
    const steam = jest
        .fn()
        .mockResolvedValue([{ gameId: 1 }, { gameId: 2 }, { gameId: 2 }]);
    const xbox = jest.fn().mockRejectedValue(new Error("provider unavailable"));
    registry.register({
        ...registry.get("steam"),
        syncHandlers: { fetchLibraryGames: steam },
    });
    registry.register({
        ...registry.get("xbox"),
        syncHandlers: { fetchLibraryGames: xbox },
    });
    const entries = { find: jest.fn().mockResolvedValue([{ gameId: 1 }]) };
    const syncs = {
        findBy: jest.fn().mockResolvedValue([
            {
                connectionId: 1,
                sourceUserId: "account-1",
                stages: {
                    discovery: { lastSucceededAt: "2026-01-01T00:00:00.000Z" },
                },
            },
            {
                connectionId: 2,
                sourceUserId: "previous",
                stages: {
                    discovery: { lastSucceededAt: "2025-01-01T00:00:00.000Z" },
                },
            },
        ]),
    };
    const current = {
        findOneByUserIdAndType: jest
            .fn()
            .mockResolvedValue(connection(1, EConnectionType.STEAM)),
    };
    const service = new ConnectionsSummaryService(
        entries as any,
        syncs as any,
        registry,
        current as any,
    );
    const result = await service.enrich("owner", [
        connection(1, EConnectionType.STEAM),
        connection(2, EConnectionType.XBOX),
    ]);
    expect(result[0]).toMatchObject({
        unprocessedCount: 1,
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result[1]).not.toHaveProperty("unprocessedCount");
    expect(result[1]).not.toHaveProperty("lastSyncedAt");
    expect(entries.find).toHaveBeenCalledTimes(1);
    expect(entries.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { libraryUserId: "owner" } }),
    );
    expect(steam).toHaveBeenCalledTimes(1);
    expect(xbox).toHaveBeenCalledTimes(1);
});

test("summaries omit data for a replaced account and return zero for an empty provider", async () => {
    const registry = new ConnectionProviderRegistry();
    registry.register({
        ...registry.get("steam"),
        syncHandlers: { fetchLibraryGames: jest.fn().mockResolvedValue([]) },
    });
    const current = {
        findOneByUserIdAndType: jest
            .fn()
            .mockResolvedValue({
                ...connection(1, EConnectionType.STEAM),
                sourceUserId: "replacement",
            }),
    };
    const service = new ConnectionsSummaryService(
        { find: jest.fn().mockResolvedValue([]) } as any,
        {
            findBy: jest
                .fn()
                .mockResolvedValue([
                    {
                        connectionId: 1,
                        sourceUserId: "account-1",
                        stages: {
                            discovery: {
                                lastSucceededAt: "2026-01-01T00:00:00Z",
                            },
                        },
                    },
                ]),
        } as any,
        registry,
        current as any,
    );
    const [replaced] = await service.enrich("owner", [
        connection(1, EConnectionType.STEAM),
    ]);
    expect(replaced).not.toHaveProperty("lastSyncedAt");
    expect(replaced).not.toHaveProperty("unprocessedCount");
    current.findOneByUserIdAndType.mockResolvedValue(
        connection(1, EConnectionType.STEAM),
    );
    const [empty] = await service.enrich("owner", [
        connection(1, EConnectionType.STEAM),
    ]);
    expect(empty.unprocessedCount).toBe(0);
});

test("public connection routes do not request private summaries", async () => {
    const summaries = { enrich: jest.fn() };
    const connections = {
        findAllByUserId: jest.fn().mockResolvedValue([]),
        findOneByUserIdAndTypeOrFail: jest.fn().mockResolvedValue({}),
    };
    const controller = new ConnectionsController(
        connections as any,
        summaries as any,
    );
    await controller.findAllByUserId("other");
    await controller.findOneByUserIdAndType("other", EConnectionType.STEAM);
    expect(summaries.enrich).not.toHaveBeenCalled();
});

test("owner count equals the filtered importer total", async () => {
    const registry = new ConnectionProviderRegistry();
    const rows = [{ gameId: 1 }];
    const importer = new ImporterService(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        registry,
        { find: jest.fn().mockResolvedValue(rows) } as any,
        { find: jest.fn().mockResolvedValue([{ id: 2, cover: null }]) } as any,
    );
    registry.register({
        ...registry.get("steam"),
        syncHandlers: {
            fetchLibraryGames: async () =>
                [
                    { id: 1, gameId: 1 },
                    { id: 2, gameId: 2 },
                    { id: 3, gameId: 2 },
                ] as any,
        },
    });
    const summary = new ConnectionsSummaryService(
        { find: jest.fn().mockResolvedValue(rows) } as any,
        { findBy: jest.fn().mockResolvedValue([]) } as any,
        registry,
        {
            findOneByUserIdAndType: jest
                .fn()
                .mockResolvedValue(connection(1, EConnectionType.STEAM)),
        } as any,
    );
    const [, total] = await importer.findUnprocessedEntries(
        "owner",
        EImporterSource.STEAM,
        { excludeInLibrary: true },
    );
    const [own] = await summary.enrich("owner", [
        connection(1, EConnectionType.STEAM),
    ]);
    expect(own.unprocessedCount).toBe(total);
    expect(own).not.toHaveProperty("lastSyncedAt");
});
