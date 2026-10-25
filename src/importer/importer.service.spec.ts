import { ConnectionProviderRegistry } from "../connection/connection-provider.registry";
import { ImporterService } from "./importer.service";
import { EImporterSource } from "./importer.constants";
import { setCacheManager } from "../utils/cacheable";

test("PSN discovery keeps first-source platform order and filters processed identities", async () => {
    setCacheManager({
        get: jest.fn(),
        set: jest.fn().mockResolvedValue(undefined),
    } as any);
    const service = new ImporterService(
        {
            findBy: jest.fn().mockResolvedValue([{ gameExternalGameId: 2 }]),
        } as any,
        { findBy: jest.fn().mockResolvedValue([]) } as any,
        {} as any,
        {
            findOneByUserIdAndTypeOrFail: jest
                .fn()
                .mockResolvedValue({ sourceUserId: "account" }),
        } as any,
        {} as any,
        {
            getExternalGamesForSourceIds: jest.fn().mockResolvedValue([
                { id: 1, gameId: 1, uid: "a" },
                { id: 2, gameId: 2, uid: "b" },
            ]),
        } as any,
        {
            getAllGames: jest.fn().mockResolvedValue([
                { concept: { id: "a" }, category: "ps4_game" },
                { concept: { id: "a" }, category: "ps5_native_game" },
                { concept: { id: "b" }, category: "ps4_game" },
            ]),
        } as any,
        {} as any,
        {
            getGamePlatformsMap: jest.fn().mockResolvedValue(
                new Map([
                    ["PS4", { id: 48 }],
                    ["PS5", { id: 167 }],
                ]),
            ),
        } as any,
        new ConnectionProviderRegistry(),
    );
    const [games, count] = await service.findUnprocessedEntries(
        "user",
        EImporterSource.PSN,
        {} as any,
    );
    expect(count).toBe(1);
    expect(games[0]).toMatchObject({ id: 1, preferredPlatformId: 48 });
});

test("discovery executes a registered handler without provider branches", async () => {
    const registry = new ConnectionProviderRegistry();
    const service = new ImporterService(
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
    );
    const handler = jest.fn().mockResolvedValue([{ id: 1, gameId: 10 }]);
    registry.register({
        ...registry.get("steam"),
        type: "future" as any,
        syncHandlers: { fetchLibraryGames: handler },
    });
    await expect(
        service.findUnprocessedCandidates("user", "future" as any),
    ).resolves.toEqual([{ id: 1, gameId: 10 }]);
    expect(handler).toHaveBeenCalledWith("user");
    registry.get("future").syncHandlers = {};
    await expect(
        service.findUnprocessedCandidates("user", "future" as any),
    ).rejects.toMatchObject({ status: 400 });
});
