import { ConnectionProviderRegistry } from "./connection-provider.registry";
import { ConnectionsSummaryService } from "./connections-summary.service";
import { EConnectionType } from "./connections.constants";
import { ConnectionsController } from "./connections.controller";
import { EConnectionAuthStatus } from "./connections.constants";

const connection = (id: number, type: EConnectionType) =>
    ({
        id,
        type,
        sourceUserId: `account-${id}`,
        profileUserId: "owner",
        authStatus: "connected",
    }) as any;

const state = (
    connectionId: number,
    sourceUserId: string,
    libraryCandidates: { id: number; gameId: number }[] | null,
) => ({
    connectionId,
    sourceUserId,
    libraryCandidates,
    stages: { discovery: { lastSucceededAt: "2026-01-01T00:00:00.000Z" } },
});

const summaries = (
    states: unknown[],
    {
        library = [] as number[],
        processed = [] as number[],
        ignored = [] as number[],
    } = {},
) => {
    const repo = (rows: unknown[]) => ({
        find: jest.fn().mockResolvedValue(rows),
    });
    const entries = repo(library.map((gameId) => ({ gameId })));
    return {
        entries,
        service: new ConnectionsSummaryService(
            entries as any,
            { findBy: jest.fn().mockResolvedValue(states) } as any,
            repo(processed.map((id) => ({ gameExternalGameId: id }))) as any,
            repo(ignored.map((id) => ({ gameExternalGameId: id }))) as any,
            new ConnectionProviderRegistry(),
        ),
    };
};

test("counts what discovery stored, minus games imported, in the library or ignored since, per distinct game", async () => {
    const { service, entries } = summaries(
        [
            state(1, "account-1", [
                { id: 10, gameId: 1 },
                { id: 20, gameId: 2 },
                { id: 21, gameId: 2 },
                { id: 30, gameId: 3 },
                { id: 40, gameId: 4 },
                { id: 50, gameId: 5 },
            ]),
            state(2, "account-2", []),
        ],
        { library: [1], processed: [30], ignored: [40] },
    );
    const [steam, xbox] = await service.enrich("owner", [
        connection(1, EConnectionType.STEAM),
        connection(2, EConnectionType.XBOX),
    ]);
    expect(steam).toMatchObject({
        unprocessedCount: 2,
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(xbox.unprocessedCount).toBe(0);
    expect(entries.find).toHaveBeenCalledTimes(1);
    expect(entries.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { libraryUserId: "owner" } }),
    );
});

test("omits the count before the first discovery, for a replaced account and when reauthorization is needed", async () => {
    const { service } = summaries([
        state(1, "account-1", null),
        state(2, "previous", [{ id: 1, gameId: 1 }]),
        state(3, "account-3", [{ id: 1, gameId: 1 }]),
    ]);
    const [fresh, replaced, reauth] = await service.enrich("owner", [
        connection(1, EConnectionType.STEAM),
        connection(2, EConnectionType.XBOX),
        {
            ...connection(3, EConnectionType.PSN),
            authStatus: EConnectionAuthStatus.REAUTH_REQUIRED,
        },
    ]);
    expect(fresh).not.toHaveProperty("unprocessedCount");
    expect(fresh.lastSyncedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(replaced).not.toHaveProperty("unprocessedCount");
    expect(replaced).not.toHaveProperty("lastSyncedAt");
    expect(reauth).not.toHaveProperty("unprocessedCount");
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
