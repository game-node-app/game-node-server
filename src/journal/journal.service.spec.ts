import { JournalService } from "./journal.service";
import { JournalHeatmapService } from "./journal-heatmap.service";
import { CollectionEntry } from "../collections/collections-entries/entities/collection-entry.entity";
import {
    LibraryAccess,
    LibraryAudience,
    LibraryVisibility,
} from "../libraries/library-visibility.constants";
import { JournalOverviewResponseDto } from "./dto/get-journal-overview.dto";
import { In } from "typeorm";

const OWNER_ACCESS: LibraryAccess = {
    audience: LibraryAudience.Owner,
    libraryVisibility: LibraryVisibility.Public,
    canViewLibrary: true,
    visibleEntryLevels: [
        LibraryVisibility.Public,
        LibraryVisibility.Followers,
        LibraryVisibility.Private,
    ],
};
const PUBLIC_ACCESS: LibraryAccess = {
    audience: LibraryAudience.Everyone,
    libraryVisibility: LibraryVisibility.Public,
    canViewLibrary: true,
    visibleEntryLevels: [LibraryVisibility.Public],
};
const HIDDEN_ACCESS: LibraryAccess = {
    audience: LibraryAudience.Everyone,
    libraryVisibility: LibraryVisibility.Private,
    canViewLibrary: false,
    visibleEntryLevels: [],
};

function entry(fields: Partial<CollectionEntry>): CollectionEntry {
    return Object.assign(new CollectionEntry(), fields);
}

function memoryCache() {
    const store = new Map<string, unknown>();
    return {
        store,
        get: jest.fn(async (key: string) => store.get(key)),
        set: jest.fn(async (key: string, value: unknown) => {
            store.set(key, value);
        }),
    };
}

function fixture(
    options: {
        entries?: CollectionEntry[];
        access?: LibraryAccess;
        hiddenGameIds?: number[];
        cache?: ReturnType<typeof memoryCache>;
    } = {},
) {
    const entries = options.entries ?? [];
    const cache = options.cache ?? memoryCache();
    const repository = {
        find: jest.fn(async ({ where }: any) => {
            const conditions: any[] = Array.isArray(where) ? where : [where];
            const levels: LibraryVisibility[] = conditions[0].visibility.value;
            return entries.filter((item) => levels.includes(item.visibility));
        }),
    };
    const libraryAccess = {
        resolve: jest.fn().mockResolvedValue(options.access ?? OWNER_ACCESS),
        hiddenGameIds: jest.fn().mockResolvedValue(options.hiddenGameIds ?? []),
    };
    const service = new JournalService(
        repository as any,
        libraryAccess as any,
        cache as any,
    );
    return { service, repository, libraryAccess, cache };
}

const overviewGameIds = (overview: JournalOverviewResponseDto) =>
    overview.years
        .flatMap((year) => year.months)
        .flatMap((month) => month.days)
        .flatMap((day) => day.entries)
        .map((item) => item.gameId);

test("groups the owner's status dates into year, month and day", async () => {
    const played = entry({
        id: "entry",
        gameId: 7,
        libraryUserId: "owner",
        visibility: LibraryVisibility.Private,
        startedAt: new Date(2024, 2, 1, 10),
        finishedAt: new Date(2024, 3, 2, 10),
    });
    const { service } = fixture({ entries: [played] });

    const overview = await service.getOverview("owner", "owner");

    expect(overview.years).toHaveLength(1);
    expect(overview.years[0].year).toBe(2024);
    expect(overview.years[0].months.map((month) => month.month)).toEqual([
        2, 3,
    ]);
    expect(
        overview.years[0].months.flatMap((month) =>
            month.days.flatMap((day) => day.entries.map((item) => item.status)),
        ),
    ).toEqual(["playing", "finished"]);
});

test("reads only the journal columns with the visible levels and no relations", async () => {
    const { service, repository } = fixture({ access: PUBLIC_ACCESS });

    await service.getOverview(undefined, "owner");

    expect(repository.find).toHaveBeenCalledWith({
        select: {
            id: true,
            gameId: true,
            startedAt: true,
            finishedAt: true,
            droppedAt: true,
            plannedAt: true,
        },
        where: {
            libraryUserId: "owner",
            visibility: In([LibraryVisibility.Public]),
        },
    });
    expect(repository.find.mock.calls[0][0]).not.toHaveProperty("relations");
});

test("filters by year in SQL, then keeps only that exact calendar year", async () => {
    const entries = [
        entry({
            id: "old",
            gameId: 1,
            libraryUserId: "owner",
            visibility: LibraryVisibility.Public,
            finishedAt: new Date(2023, 5, 1),
        }),
        entry({
            id: "new",
            gameId: 2,
            libraryUserId: "owner",
            visibility: LibraryVisibility.Public,
            startedAt: new Date(2024, 5, 1),
        }),
    ];
    const { service, repository } = fixture({ entries });

    const filtered = await service.getOverview("owner", "owner", 2024);

    expect(overviewGameIds(filtered)).toEqual([2]);
    expect(filtered.years.map((year) => year.year)).toEqual([2024]);
    const [{ where }] = repository.find.mock.calls[0] as [
        { where: Record<string, unknown>[] },
    ];
    expect(
        where.map((condition) =>
            Object.keys(condition).find(
                (key) => key !== "libraryUserId" && key !== "visibility",
            ),
        ),
    ).toEqual(["startedAt", "finishedAt", "droppedAt", "plannedAt"]);

    const all = await service.getOverview("owner", "owner");
    expect(all.years.map((year) => year.year).toSorted()).toEqual([2023, 2024]);
});

test("returns no years when the requested year has no status dates", async () => {
    const entries = [
        entry({
            id: "old",
            gameId: 1,
            libraryUserId: "owner",
            visibility: LibraryVisibility.Public,
            finishedAt: new Date(2024, 5, 1),
        }),
    ];
    const { service } = fixture({ entries });

    await expect(service.getOverview("owner", "owner", 2030)).resolves.toEqual({
        years: [],
    });
});

test("returns no years without querying entries when the library is hidden", async () => {
    const { service, repository } = fixture({ access: HIDDEN_ACCESS });

    await expect(service.getOverview(undefined, "owner")).resolves.toEqual({
        years: [],
    });
    expect(repository.find).not.toHaveBeenCalled();
});

test("serves the cached overview for the same audience and year", async () => {
    const cached: JournalOverviewResponseDto = {
        years: [{ year: 2024, months: [] }],
    };
    const cache = memoryCache();
    cache.get.mockResolvedValue(cached);
    const { service, repository } = fixture({ cache });

    await expect(service.getOverview(undefined, "owner", 2024)).resolves.toBe(
        cached,
    );
    expect(cache.get).toHaveBeenCalledWith(expect.stringContaining(":2024"));
    expect(repository.find).not.toHaveBeenCalled();
});

test("partitions the cache by audience so a visitor never gets the owner's entries", async () => {
    const entries = [
        entry({
            id: "public",
            gameId: 1,
            libraryUserId: "owner",
            visibility: LibraryVisibility.Public,
            finishedAt: new Date(2024, 5, 1),
        }),
        entry({
            id: "private",
            gameId: 2,
            libraryUserId: "owner",
            visibility: LibraryVisibility.Private,
            finishedAt: new Date(2024, 6, 1),
        }),
    ];
    const { service, libraryAccess, cache } = fixture({ entries });
    libraryAccess.resolve.mockImplementation(async (viewerId: string) =>
        viewerId === "owner" ? OWNER_ACCESS : PUBLIC_ACCESS,
    );
    libraryAccess.hiddenGameIds.mockImplementation(
        async (_ownerId: string, levels: LibraryVisibility[]) =>
            levels.includes(LibraryVisibility.Private) ? [] : [2],
    );

    const ownerOverview = await service.getOverview("owner", "owner");
    const visitorOverview = await service.getOverview(undefined, "owner");

    expect(overviewGameIds(ownerOverview).toSorted()).toEqual([1, 2]);
    expect(overviewGameIds(visitorOverview)).toEqual([1]);
    const [ownerKey, visitorKey] = cache.set.mock.calls.map(([key]) => key);
    expect(ownerKey).toContain(":owner:owner:");
    expect(visitorKey).toContain(":everyone:");
    expect(visitorKey).not.toBe(ownerKey);
});

test("recomputes the visitor's view when an entry becomes private", async () => {
    const visible = entry({
        id: "entry",
        gameId: 1,
        libraryUserId: "owner",
        visibility: LibraryVisibility.Public,
        finishedAt: new Date(2024, 5, 1),
    });
    const { service, libraryAccess, cache } = fixture({ entries: [visible] });
    libraryAccess.resolve.mockResolvedValue(PUBLIC_ACCESS);

    const before = await service.getOverview(undefined, "owner");
    expect(overviewGameIds(before)).toEqual([1]);

    visible.visibility = LibraryVisibility.Private;
    libraryAccess.hiddenGameIds.mockResolvedValue([1]);

    const after = await service.getOverview(undefined, "owner");
    expect(overviewGameIds(after)).toEqual([]);
    const [beforeKey, afterKey] = cache.set.mock.calls.map(([key]) => key);
    expect(afterKey).not.toBe(beforeKey);
});

test("falls back to the database when the cache fails", async () => {
    const cache = memoryCache();
    cache.get.mockRejectedValue(new Error("cache down"));
    cache.set.mockRejectedValue(new Error("cache down"));
    const { service } = fixture({
        entries: [
            entry({
                id: "entry",
                gameId: 1,
                libraryUserId: "owner",
                visibility: LibraryVisibility.Private,
                finishedAt: new Date(2024, 5, 1),
            }),
        ],
        cache,
    });

    await expect(service.getOverview("owner", "owner")).resolves.toMatchObject({
        years: [{ year: 2024 }],
    });
});

test("feeds the heatmap with the unfiltered overview", async () => {
    const { service, cache } = fixture({
        entries: [
            entry({
                id: "entry",
                gameId: 1,
                libraryUserId: "owner",
                visibility: LibraryVisibility.Private,
                finishedAt: new Date(2024, 6, 12),
            }),
        ],
    });
    const heatmap = new JournalHeatmapService(service);

    const result = await heatmap.buildHeatmap(undefined, "owner");

    expect(result.items).toHaveLength(1);
    expect(result.items[0].count).toBe(1);
    expect(cache.get).toHaveBeenCalledWith(expect.stringContaining(":all"));
});
