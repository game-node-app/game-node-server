import { ConnectionProviderRegistry } from "../connection/connection-provider.registry";
import { ImporterService } from "./importer.service";
import { EImporterSource } from "./importer.constants";
import { setCacheManager } from "../utils/cacheable";
import { ImporterSearchService } from "./importer-search/importer-search.service";

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
        { find: jest.fn().mockResolvedValue([]) } as any,
        { find: jest.fn().mockResolvedValue([{ id: 1, cover: null }]) } as any,
    );
    const [games, count] = await service.findUnprocessedEntries(
        "user",
        EImporterSource.PSN,
        {} as any,
    );
    expect(count).toBe(1);
    expect(games[0]).toMatchObject({ id: 1, preferredPlatformId: 48 });
    const all = await service.findProviderCandidates(
        "user",
        EImporterSource.PSN,
        true,
    );
    expect(all.map((game) => game.id)).toEqual([1, 2]);
    expect(service.validateCandidateIds(all, [2, 2])).toHaveLength(1);
    expect(() => service.validateCandidateIds(all, [3])).toThrow(
        "Invalid importer candidate",
    );
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
        {} as any,
        {} as any,
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

test("candidate validation is restricted to the user's selected provider snapshot", async () => {
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
        {} as any,
        {} as any,
    );
    registry.register({
        ...registry.get("steam"),
        syncHandlers: {
            fetchLibraryGames: async (user) =>
                (user === "owner"
                    ? [
                          { id: 1, gameId: 10 },
                          { id: 2, gameId: 10 },
                      ]
                    : [{ id: 3, gameId: 11 }]) as any,
        },
    });
    registry.register({
        ...registry.get("psn"),
        syncHandlers: {
            fetchLibraryGames: async () => [{ id: 4, gameId: 12 }] as any,
        },
    });
    const snapshot = await service.findProviderCandidates(
        "owner",
        EImporterSource.STEAM,
        true,
    );
    expect(
        service
            .validateCandidateIds(snapshot, [1, 2, 2])
            .map((entry) => entry.id),
    ).toEqual([1, 2]);
    expect(() => service.validateCandidateIds(snapshot, [3])).toThrow();
    expect(() => service.validateCandidateIds(snapshot, [4])).toThrow();
    expect(
        await service.findUnprocessedCandidates("owner", EImporterSource.STEAM),
    ).toHaveLength(1);
});

test("snapshot binds discovery to the selected connection account", async () => {
    const registry = new ConnectionProviderRegistry();
    const handler = jest.fn().mockResolvedValue([]);
    const service = new ImporterService(
        {} as any,
        {} as any,
        {} as any,
        {
            findOneByUserIdAndTypeOrFail: jest
                .fn()
                .mockResolvedValue({ id: 7, sourceUserId: "account" }),
        } as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        registry,
        {} as any,
        {} as any,
    );
    registry.register({
        ...registry.get("steam"),
        syncHandlers: { fetchLibraryGames: handler },
    });
    const snapshot = await service.findProviderSnapshot(
        "owner",
        EImporterSource.STEAM,
    );
    expect(snapshot.connection).toMatchObject({
        id: 7,
        sourceUserId: "account",
    });
    expect(handler).toHaveBeenCalledWith("owner", true, "account");
});

test("listing filters the user's library before search and pagination and hydrates only the page", async () => {
    const registry = new ConnectionProviderRegistry();
    const findLibrary = jest.fn(async ({ where }) =>
        where.libraryUserId === "owner" ? [{ gameId: 1 }, { gameId: 2 }] : [],
    );
    const findGames = jest.fn(async ({ where }) =>
        where.id.value.map((id: number) => ({
            id,
            cover: id === 3 ? null : { id },
        })),
    );
    const service = new ImporterService(
        {} as any,
        {} as any,
        new ImporterSearchService(),
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        registry,
        { find: findLibrary } as any,
        { find: findGames } as any,
    );
    registry.register({
        ...registry.get("steam"),
        syncHandlers: {
            fetchLibraryGames: async () =>
                ["Alpha", "Beta", "Zzzzzzzzzz", "Delta"].map((name, index) => ({
                    id: index + 1,
                    gameId: index + 1,
                    name,
                })) as any,
        },
    });
    const [page, total] = await service.findUnprocessedEntries(
        "owner",
        EImporterSource.STEAM,
        { offset: 0, limit: 2 },
    );
    expect(total).toBe(4);
    expect(page.map((item) => item.isInLibrary)).toEqual([true, true]);
    const [filtered, filteredTotal] = await service.findUnprocessedEntries(
        "owner",
        EImporterSource.STEAM,
        { excludeInLibrary: true, search: "Zzzzzzzzzz" },
    );
    expect(filteredTotal).toBe(1);
    expect(filtered[0]).toMatchObject({
        id: 3,
        isInLibrary: false,
        game: { cover: null },
    });
    const [, otherTotal] = await service.findUnprocessedEntries(
        "other",
        EImporterSource.STEAM,
        { excludeInLibrary: true },
    );
    expect(otherTotal).toBe(4);
    expect(findLibrary).toHaveBeenCalledTimes(3);
    expect(findGames).toHaveBeenCalledTimes(3);
});
