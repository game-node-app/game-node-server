import { ConnectionProviderRegistry } from "../connection/connection-provider.registry";
import { ImporterService } from "./importer.service";
import { EImporterSource } from "./importer.constants";
import { EGameExternalGameCategory } from "../game/game-repository/game-repository.constants";
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
        {} as any,
        {} as any,
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
        {} as any,
        {} as any,
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

test("shared matching returns processed entries only when marked entries are included", async () => {
    const service = new ImporterService(
        {
            findBy: jest.fn().mockResolvedValue([{ gameExternalGameId: 2 }]),
        } as any,
        { findBy: jest.fn().mockResolvedValue([]) } as any,
        {} as any,
        {} as any,
        {
            getLibraryGames: jest
                .fn()
                .mockResolvedValue([
                    { game: { id: "a" } },
                    { game: { id: "b" } },
                ]),
        } as any,
        {
            getExternalGamesForSourceIds: jest.fn().mockResolvedValue([
                { id: 1, gameId: 1, uid: "a" },
                { id: 2, gameId: 2, uid: "b" },
            ]),
        } as any,
        {} as any,
        {} as any,
        {} as any,
        new ConnectionProviderRegistry(),
        {} as any,
        {} as any,
        {} as any,
        {} as any,
    );
    const ids = async (includeMarked: boolean) =>
        (
            await service.findProviderCandidates(
                "user",
                EImporterSource.STEAM,
                includeMarked,
                "steam-account",
            )
        ).map((item) => item.id);
    expect(await ids(false)).toEqual([1]);
    expect(await ids(true)).toEqual([1, 2]);
});

describe("Epic Games discovery", () => {
    const build = (mapped: any[], named: string[] = []) => {
        const getCatalogTitle = jest.fn().mockResolvedValue("Orphan Game");
        const registerUnmappedGames = jest.fn();
        const getExternalGamesForSourceIds = jest
            .fn()
            .mockResolvedValue(mapped);
        const service = new ImporterService(
            { findBy: jest.fn().mockResolvedValue([]) } as any,
            { findBy: jest.fn().mockResolvedValue([]) } as any,
            {} as any,
            {} as any,
            {} as any,
            {
                getExternalGamesForSourceIds,
                registerUnmappedGames,
                findNamedUnmappedUids: jest
                    .fn()
                    .mockResolvedValue(new Set(named)),
            } as any,
            {} as any,
            {} as any,
            {} as any,
            new ConnectionProviderRegistry(),
            {} as any,
            {} as any,
            {
                getLibraryItems: jest.fn().mockResolvedValue([
                    { namespace: "mapped", appName: "base" },
                    { namespace: "mapped", appName: "addon-1" },
                    { namespace: "mapped", appName: "addon-2" },
                    { namespace: "orphan", appName: "x", catalogItemId: "c1" },
                ]),
                getCatalogTitle,
            } as any,
            {} as any,
        );
        return {
            service,
            registerUnmappedGames,
            getExternalGamesForSourceIds,
            getCatalogTitle,
        };
    };

    it("lists a base game and its add-ons once, on the PC platform", async () => {
        const { service, getExternalGamesForSourceIds } = build([
            { id: 1, gameId: 1, uid: "mapped" },
        ]);
        const items = await service.findProviderCandidates(
            "user",
            EImporterSource.EPIC_GAMES,
            false,
            "epic-account",
        );
        expect(items).toEqual([
            expect.objectContaining({ id: 1, preferredPlatformId: 6 }),
        ]);
        expect(getExternalGamesForSourceIds).toHaveBeenCalledWith(
            ["mapped", "orphan"],
            1001,
            false,
        );
    });

    it("registers namespaces without a mapping as unmapped and does not list them", async () => {
        const { service, registerUnmappedGames } = build([
            { id: 1, gameId: 1, uid: "mapped" },
        ]);
        const items = await service.findProviderCandidates(
            "user",
            EImporterSource.EPIC_GAMES,
            false,
            "epic-account",
        );
        expect(items.map((item) => item.id)).toEqual([1]);
        expect(registerUnmappedGames).toHaveBeenCalledTimes(1);
        expect(registerUnmappedGames).toHaveBeenCalledWith(
            1001,
            [{ sourceUid: "orphan", name: "Orphan Game" }],
            "user",
        );
    });

    it("registers an unmapped namespace without a catalog call when it already has a name", async () => {
        const { service, registerUnmappedGames, getCatalogTitle } = build(
            [{ id: 1, gameId: 1, uid: "mapped" }],
            ["orphan"],
        );
        await service.findProviderCandidates(
            "user",
            EImporterSource.EPIC_GAMES,
            false,
            "epic-account",
        );
        expect(getCatalogTitle).not.toHaveBeenCalled();
        expect(registerUnmappedGames).toHaveBeenCalledWith(
            1001,
            [{ sourceUid: "orphan", name: undefined }],
            "user",
        );
    });
});

describe("Nintendo discovery", () => {
    const entry = (titleId: string, platform: string, last: string) => ({
        titleId,
        titleName: `Name ${titleId}`,
        platform,
        minutes: 10,
        lastPlayedAt: new Date(last),
    });
    const build = (mapped: any[], processedIds: number[] = []) => {
        const registerUnmappedGames = jest.fn();
        const getExternalGamesForSourceIds = jest
            .fn()
            .mockResolvedValue(mapped);
        const service = new ImporterService(
            {
                findBy: jest
                    .fn()
                    .mockResolvedValue(
                        processedIds.map((id) => ({ gameExternalGameId: id })),
                    ),
            } as any,
            { findBy: jest.fn().mockResolvedValue([]) } as any,
            {} as any,
            {} as any,
            {} as any,
            { getExternalGamesForSourceIds, registerUnmappedGames } as any,
            {} as any,
            {} as any,
            {} as any,
            new ConnectionProviderRegistry(),
            {} as any,
            {} as any,
            {} as any,
            {
                getPlayHistory: jest
                    .fn()
                    .mockResolvedValue([
                        entry("A", "HAC", "2026-01-01"),
                        entry("A", "BEE", "2026-06-01"),
                        entry("B", "HAC", "2026-02-01"),
                        entry("C", "HAC", "2026-03-01"),
                    ]),
            } as any,
        );
        return { service, registerUnmappedGames };
    };
    const discover = (service: ImporterService, includeMarked = false) =>
        service.findProviderCandidates(
            "user",
            EImporterSource.NINTENDO,
            includeMarked,
            "nintendo-account",
        );

    it("lists a title played on both consoles once, on the console played last", async () => {
        const { service } = build([
            { id: 1, gameId: 1, uid: "A" },
            { id: 2, gameId: 2, uid: "B" },
        ]);
        const items = await discover(service);
        expect(
            items.map((item) => [item.id, item.preferredPlatformId]),
        ).toEqual([
            [1, 508],
            [2, 130],
        ]);
    });

    it("registers an unmapped title with its name and does not list it", async () => {
        const { service, registerUnmappedGames } = build([
            { id: 1, gameId: 1, uid: "A" },
        ]);
        const items = await discover(service);
        expect(items.map((item) => item.id)).toEqual([1]);
        expect(registerUnmappedGames).toHaveBeenCalledWith(
            1002,
            [
                { sourceUid: "B", name: "Name B" },
                { sourceUid: "C", name: "Name C" },
            ],
            "user",
        );
    });

    it("hides processed entries unless they are included", async () => {
        const mapped = [
            { id: 1, gameId: 1, uid: "A" },
            { id: 2, gameId: 2, uid: "B" },
        ];
        const { service } = build(mapped, [2]);
        expect((await discover(service)).map((item) => item.id)).toEqual([1]);
        expect((await discover(service, true)).map((item) => item.id)).toEqual([
            1, 2,
        ]);
    });
});

describe("unmapped registration during discovery", () => {
    const build = (providers: { steam?: any; psn?: any; xbox?: any }) => {
        const registerUnmappedGames = jest.fn().mockResolvedValue(undefined);
        const service = new ImporterService(
            { findBy: jest.fn().mockResolvedValue([]) } as any,
            { findBy: jest.fn().mockResolvedValue([]) } as any,
            {} as any,
            {} as any,
            providers.steam ?? ({} as any),
            {
                getExternalGamesForSourceIds: jest.fn().mockResolvedValue([]),
                registerUnmappedGames,
            } as any,
            providers.psn ?? ({} as any),
            providers.xbox ?? ({} as any),
            {
                getGamePlatformsMap: jest.fn().mockResolvedValue(new Map()),
            } as any,
            new ConnectionProviderRegistry(),
            {} as any,
            {} as any,
            {} as any,
            {} as any,
        );
        return { service, registerUnmappedGames };
    };
    const discover = (service: ImporterService, source: EImporterSource) =>
        service.findProviderCandidates("user", source, false, "account");

    it("registers Steam apps once with their names and the user", async () => {
        const { service, registerUnmappedGames } = build({
            steam: {
                getLibraryGames: jest
                    .fn()
                    .mockResolvedValue([
                        { game: { id: 1, name: "Hollow Knight" } },
                        { game: { id: 2 } },
                    ]),
            },
        });
        await discover(service, EImporterSource.STEAM);
        expect(registerUnmappedGames).toHaveBeenCalledTimes(1);
        expect(registerUnmappedGames).toHaveBeenCalledWith(
            EGameExternalGameCategory.Steam,
            [
                { sourceUid: "1", name: "Hollow Knight" },
                { sourceUid: "2", name: undefined },
            ],
            "user",
        );
    });

    it("registers PSN concepts once with their names and the user", async () => {
        const { service, registerUnmappedGames } = build({
            psn: {
                getAllGames: jest.fn().mockResolvedValue([
                    {
                        concept: { id: 7 },
                        name: "Bloodborne",
                        category: "ps4_game",
                    },
                    {
                        concept: { id: 7 },
                        name: "Bloodborne",
                        category: "ps4_game",
                    },
                ]),
            },
        });
        await discover(service, EImporterSource.PSN);
        expect(registerUnmappedGames).toHaveBeenCalledTimes(1);
        expect(registerUnmappedGames).toHaveBeenCalledWith(
            EGameExternalGameCategory.PlaystationStoreUs,
            [{ sourceUid: "7", name: "Bloodborne" }],
            "user",
        );
    });

    it("registers Xbox products once with their names and the user", async () => {
        const { service, registerUnmappedGames } = build({
            xbox: {
                getAllGames: jest
                    .fn()
                    .mockResolvedValue([
                        { productId: "p1", name: "Halo", devices: [] },
                    ]),
            },
        });
        await discover(service, EImporterSource.XBOX);
        expect(registerUnmappedGames).toHaveBeenCalledTimes(1);
        expect(registerUnmappedGames).toHaveBeenCalledWith(
            EGameExternalGameCategory.Microsoft,
            [{ sourceUid: "p1", name: "Halo" }],
            "user",
        );
    });
});
