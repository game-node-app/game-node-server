import { CollectionEntryStatus } from "./collections-entries.constants";
const mockCommitCallbacks: Array<() => void> = [];
jest.mock("typeorm-transactional", () => ({
    Transactional:
        () =>
        (_target: object, _name: string, descriptor: PropertyDescriptor) =>
            descriptor,
    runOnTransactionCommit: (callback: () => void) =>
        mockCommitCallbacks.push(callback),
}));
import { CollectionsEntriesService } from "./collections-entries.service";
import { Library } from "../../libraries/entities/library.entity";
import { In } from "typeorm";
import { CreateUpdateCollectionEntryDto } from "./dto/create-update-collection-entry.dto";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CollectionEntry } from "./entities/collection-entry.entity";
import { CollectionEntryStatusHistory } from "./entities/collection-entry-status-history.entity";
import {
    LibraryAudience,
    LibraryVisibility,
} from "../../libraries/library-visibility.constants";
import { LevelIncreaseActivities } from "../../level/level.constants";

const OWNER_ACCESS = {
    audience: LibraryAudience.Owner,
    libraryVisibility: LibraryVisibility.Public,
    canViewLibrary: true,
    visibleEntryLevels: [
        LibraryVisibility.Public,
        LibraryVisibility.Followers,
        LibraryVisibility.Private,
    ],
};
const PUBLIC_ACCESS = {
    audience: LibraryAudience.Everyone,
    libraryVisibility: LibraryVisibility.Public,
    canViewLibrary: true,
    visibleEntryLevels: [LibraryVisibility.Public],
};
const FOLLOWER_ACCESS = {
    audience: LibraryAudience.Follower,
    libraryVisibility: LibraryVisibility.Public,
    canViewLibrary: true,
    visibleEntryLevels: [
        LibraryVisibility.Public,
        LibraryVisibility.Followers,
    ],
};
const HIDDEN_ACCESS = {
    audience: LibraryAudience.Everyone,
    libraryVisibility: LibraryVisibility.Private,
    canViewLibrary: false,
    visibleEntryLevels: [],
};

function fixture(
    existing?: any,
    collections: any[] = [],
    nonOwnerAccess: any = PUBLIC_ACCESS,
) {
    const lock = jest.fn().mockResolvedValue({ userId: "owner" });
    const achievements = { addTrackingJob: jest.fn() };
    const activities = { register: jest.fn() };
    const levels = { registerLevelExpIncreaseActivity: jest.fn() };
    const notifications = { invalidateLibraryContent: jest.fn() };
    const guildQueue = { enqueueEvaluation: jest.fn() };
    const statusHistory = {
        insert: jest.fn().mockResolvedValue(undefined),
        existsBy: jest.fn().mockResolvedValue(false),
    };
    const repository = {
        findOne: jest.fn().mockResolvedValue(existing),
        find: jest.fn().mockResolvedValue([]),
        save: jest.fn(async (row) => ({ ...row, id: "entry" })),
        update: jest.fn(),
        findAndCount: jest.fn().mockResolvedValue([[], 0]),
        manager: {
            getRepository: jest.fn((entity) =>
                entity === CollectionEntryStatusHistory
                    ? statusHistory
                    : { findOne: lock },
            ),
        },
    };
    const collectionsService = {
        findAllByIds: jest.fn().mockResolvedValue(collections),
        findOneById: jest.fn(),
    };
    const userGameCovers = { find: jest.fn().mockResolvedValue([]) };
    const libraryAccess = {
        resolve: jest.fn(
            async (viewerId: string | undefined, ownerId: string) =>
                viewerId === ownerId ? OWNER_ACCESS : nonOwnerAccess,
        ),
    };
    const service = new CollectionsEntriesService(
        repository as any,
        {} as any,
        activities as any,
        achievements as any,
        levels as any,
        collectionsService as any,
        {} as any,
        userGameCovers as any,
        notifications as any,
        libraryAccess as any,
        guildQueue as any,
    );
    jest.spyOn(service as any, "updateAssociatedCollections").mockResolvedValue(
        undefined,
    );
    return {
        service,
        repository,
        lock,
        achievements,
        activities,
        levels,
        notifications,
        collectionsService,
        userGameCovers,
        libraryAccess,
        guildQueue,
        statusHistory,
    };
}

function entryWithCollections(
    libraryUserId: string,
    ...publicFlags: boolean[]
) {
    const entry = new CollectionEntry();
    entry.libraryUserId = libraryUserId;
    entry.collectionsMap = publicFlags.map(
        (isPublic, index) =>
            ({ collection: { id: `collection-${index}`, isPublic } }) as any,
    );
    return entry;
}


test("changes favorite status on the authenticated user's entry", async () => {
    const { service, repository } = fixture({ id: "entry" });
    await service.changeFavoriteStatus("owner", 7, true);
    expect(repository.update).toHaveBeenCalledWith(
        { id: "entry" },
        expect.objectContaining({ isFavorite: true }),
    );
});

test("recreating an entry preserves its existing favorite preference", async () => {
    const { service, repository, lock } = fixture({
        id: "entry",
        isFavorite: true,
    });
    await service.createOrUpdate("owner", {
        gameId: 7,
        status: CollectionEntryStatus.PLANNED,
        collectionIds: [],
        platformIds: [6],
    });
    expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ isFavorite: true }),
    );
    expect(repository.manager.getRepository).toHaveBeenCalledWith(Library);
    expect(lock).toHaveBeenCalledWith({
        where: { userId: "owner" },
        lock: { mode: "pessimistic_write" },
    });
});

test("import creation leaves an existing entry's user data untouched", async () => {
    const { service, repository } = fixture({
        id: "entry",
        isFavorite: true,
        status: "finished",
    });
    expect(
        await service.createOrUpdate(
            "owner",
            {
                gameId: 7,
                status: CollectionEntryStatus.PLANNED,
                collectionIds: [],
                platformIds: [6],
            },
            true,
        ),
    ).toBe(false);
    expect(repository.save).not.toHaveBeenCalled();
});

test("adding or updating an entry evaluates library and finished game achievements", async () => {
    const { service, achievements } = fixture();
    await service.createOrUpdate("owner", {
        gameId: 7,
        status: CollectionEntryStatus.FINISHED,
        collectionIds: [],
        platformIds: [6],
    });
    expect(achievements.addTrackingJob.mock.calls).toEqual([
        [{ userId: "owner", metric: "library_games" }],
        [{ userId: "owner", metric: "games_finished" }],
    ]);
});

describe("library status history", () => {
    const dto = (extra: Record<string, unknown> = {}) => ({
        gameId: 7,
        status: CollectionEntryStatus.FINISHED,
        collectionIds: [],
        platformIds: [6],
        ...extra,
    });

    test("records a creation and a status change, but not an unchanged re-save", async () => {
        const created = fixture();
        await created.service.createOrUpdate("owner", dto());
        expect(created.statusHistory.insert).toHaveBeenCalledWith([
            expect.objectContaining({
                libraryUserId: "owner",
                gameId: 7,
                collectionEntryId: "entry",
                fromStatus: null,
                toStatus: CollectionEntryStatus.FINISHED,
                source: "manual",
                occurredAt: expect.any(Date),
            }),
        ]);

        const changed = fixture({
            id: "entry",
            status: CollectionEntryStatus.PLANNED,
        });
        await changed.service.createOrUpdate("owner", dto());
        expect(changed.statusHistory.insert).toHaveBeenCalledWith([
            expect.objectContaining({
                fromStatus: CollectionEntryStatus.PLANNED,
                toStatus: CollectionEntryStatus.FINISHED,
            }),
        ]);

        const unchanged = fixture({
            id: "entry",
            status: CollectionEntryStatus.PLANNED,
        });
        await unchanged.service.createOrUpdate(
            "owner",
            dto({ status: CollectionEntryStatus.PLANNED }),
        );
        expect(unchanged.statusHistory.insert).not.toHaveBeenCalled();
    });

    test("records imports as import and related entries as related", async () => {
        const imported = fixture();
        await imported.service.createForImport("owner", 7, 6);
        expect(imported.statusHistory.insert).toHaveBeenCalledWith([
            expect.objectContaining({
                source: "import",
                fromStatus: null,
                toStatus: CollectionEntryStatus.PLANNED,
            }),
        ]);

        const related = fixture();
        await related.service.createOrUpdate(
            "owner",
            dto({ relatedGameIds: [2] }),
        );
        expect(related.statusHistory.insert).toHaveBeenLastCalledWith([
            expect.objectContaining({
                gameId: 2,
                source: "related",
                fromStatus: null,
                toStatus: CollectionEntryStatus.FINISHED,
            }),
        ]);
    });

    test("grants game-finished XP only for the first finish", async () => {
        const first = fixture();
        await first.service.createOrUpdate("owner", dto());
        expect(
            first.levels.registerLevelExpIncreaseActivity,
        ).toHaveBeenCalledWith("owner", LevelIncreaseActivities.GAME_FINISHED);

        const reFinish = fixture({
            id: "entry",
            status: CollectionEntryStatus.PLANNED,
        });
        reFinish.statusHistory.existsBy.mockResolvedValue(true);
        await reFinish.service.createOrUpdate("owner", dto());
        expect(
            reFinish.levels.registerLevelExpIncreaseActivity,
        ).not.toHaveBeenCalled();

        const unchanged = fixture({
            id: "entry",
            status: CollectionEntryStatus.FINISHED,
            finishedAt: new Date(),
        });
        await unchanged.service.createOrUpdate("owner", dto());
        expect(
            unchanged.levels.registerLevelExpIncreaseActivity,
        ).not.toHaveBeenCalled();
    });
});

describe("status date preservation", () => {
    const dto = (
        extra: Partial<CreateUpdateCollectionEntryDto> = {},
    ): CreateUpdateCollectionEntryDto => ({
        gameId: 7,
        status: CollectionEntryStatus.PLANNED,
        collectionIds: [],
        platformIds: [6],
        ...extra,
    });
    const plannedAt = new Date("2023-01-02T03:04:05Z");

    test("keeps the stored dates when the status does not change", async () => {
        const { service, repository } = fixture({
            id: "entry",
            status: CollectionEntryStatus.PLANNED,
            plannedAt,
            startedAt: null,
            droppedAt: null,
            finishedAt: null,
        });

        await service.createOrUpdate("owner", dto());

        expect(repository.save).toHaveBeenCalledWith(
            expect.objectContaining({
                status: CollectionEntryStatus.PLANNED,
                plannedAt,
            }),
        );
    });

    test("keeps a stored finishedAt unless one is supplied", async () => {
        const finishedAt = new Date("2024-05-06T07:08:09Z");
        const stored = {
            id: "entry",
            status: CollectionEntryStatus.FINISHED,
            plannedAt,
            startedAt: null,
            droppedAt: null,
            finishedAt,
        };

        const untouched = fixture({ ...stored });
        await untouched.service.createOrUpdate(
            "owner",
            dto({ status: CollectionEntryStatus.FINISHED }),
        );
        expect(untouched.repository.save).toHaveBeenCalledWith(
            expect.objectContaining({ finishedAt }),
        );

        const supplied = new Date("2025-01-01T00:00:00Z");
        const updated = fixture({ ...stored });
        await updated.service.createOrUpdate(
            "owner",
            dto({
                status: CollectionEntryStatus.FINISHED,
                finishedAt: supplied,
            }),
        );
        expect(updated.repository.save).toHaveBeenCalledWith(
            expect.objectContaining({ finishedAt: supplied }),
        );
    });
});

describe("guild contract evaluation hook", () => {
    const dto = {
        gameId: 7,
        status: CollectionEntryStatus.FINISHED,
        collectionIds: [],
        platformIds: [6],
    };

    test("schedules evaluation only after the entry transaction commits", async () => {
        const { service, guildQueue } = fixture();
        mockCommitCallbacks.length = 0;

        await service.createOrUpdate("owner", dto);

        expect(guildQueue.enqueueEvaluation).not.toHaveBeenCalled();
        for (const callback of mockCommitCallbacks.splice(0)) callback();
        expect(guildQueue.enqueueEvaluation).toHaveBeenCalledWith(
            "owner",
            "collection_entry",
        );
    });

    test("does not wait for the evaluation queue before returning", async () => {
        const { service, guildQueue } = fixture();
        mockCommitCallbacks.length = 0;
        guildQueue.enqueueEvaluation.mockReturnValue(new Promise(() => {}));

        await expect(
            service.createOrUpdate("owner", dto),
        ).resolves.toBeUndefined();

        for (const callback of mockCommitCallbacks.splice(0)) callback();
        expect(guildQueue.enqueueEvaluation).toHaveBeenCalledTimes(1);
    });
});

describe("collection ownership", () => {
    const dto = (collectionIds: string[]) => ({
        gameId: 7,
        status: CollectionEntryStatus.PLANNED,
        collectionIds,
        platformIds: [6],
    });

    test("accepts the caller's own collections", async () => {
        const { service, repository } = fixture(undefined, [
            { id: "a", libraryUserId: "owner" },
            { id: "b", libraryUserId: "owner" },
        ]);
        await service.createOrUpdate("owner", dto(["a", "b", "a"]));
        expect(repository.save).toHaveBeenCalledTimes(1);
    });

    test("rejects a collection owned by someone else before writing", async () => {
        const { service, repository } = fixture({ id: "entry" }, [
            { id: "a", libraryUserId: "owner" },
            { id: "b", libraryUserId: "intruder" },
        ]);
        await expect(
            service.createOrUpdate("owner", dto(["a", "b"])),
        ).rejects.toMatchObject({ status: 403 });
        expect(repository.save).not.toHaveBeenCalled();
    });

    test("rejects an unknown collection id", async () => {
        const { service, repository } = fixture(undefined, []);
        await expect(
            service.createOrUpdate("owner", dto(["missing"])),
        ).rejects.toMatchObject({ status: 403 });
        expect(repository.save).not.toHaveBeenCalled();
    });

    test("accepts an empty collection list", async () => {
        const { service, repository } = fixture();
        await service.createOrUpdate("owner", dto([]));
        expect(repository.save).toHaveBeenCalledTimes(1);
    });
});

describe("custom cover filter", () => {
    test("filters the owner's library by their chosen games", async () => {
        const { service, repository, userGameCovers } = fixture();
        userGameCovers.find.mockResolvedValue([{ gameId: 7 }]);
        repository.findAndCount.mockResolvedValue([
            [{ id: "entry", gameId: 7 }],
            1,
        ]);

        await service.findAllByUserIdWithPermissions("owner", "owner", {
            hasCustomCover: true,
        });

        expect(userGameCovers.find).toHaveBeenCalledWith({
            select: { gameId: true },
            where: { userId: "owner" },
        });
        expect(repository.findAndCount).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ gameId: In([7]) }),
            }),
        );
    });

    test("returns an empty page for an owner with no choices without listing entries", async () => {
        const { service, repository } = fixture();

        const result = await service.findAllByUserIdWithPermissions(
            "owner",
            "owner",
            { hasCustomCover: true },
        );

        expect(result).toEqual([[], 0]);
        expect(repository.findAndCount).not.toHaveBeenCalled();
    });

    test("filters favorites by the owner's chosen games", async () => {
        const { service, repository, userGameCovers } = fixture();
        userGameCovers.find.mockResolvedValue([{ gameId: 7 }]);

        await service.findFavoritesByUserId("owner", "owner", {
            hasCustomCover: true,
        });

        expect(repository.findAndCount).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    isFavorite: true,
                    gameId: In([7]),
                }),
            }),
        );
    });

    test("filters a collection listing by the collection owner's choices", async () => {
        const { service, repository, collectionsService, userGameCovers } =
            fixture();
        collectionsService.findOneById.mockResolvedValue({
            id: "collection",
            libraryUserId: "owner",
            isPublic: true,
        });
        userGameCovers.find.mockResolvedValue([{ gameId: 7 }]);

        await service.findAllByCollectionIdWithPermissions(
            "viewer",
            "collection",
            { hasCustomCover: true },
        );

        expect(collectionsService.findOneById).toHaveBeenCalledWith(
            "collection",
        );
        expect(userGameCovers.find).toHaveBeenCalledWith({
            select: { gameId: true },
            where: { userId: "owner" },
        });
        expect(repository.findAndCount).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ gameId: In([7]) }),
            }),
        );
    });

    test("lists only the visibility levels the viewer may see", async () => {
        const { service, repository, userGameCovers } = fixture();
        userGameCovers.find.mockResolvedValue([{ gameId: 7 }]);

        await service.findAllByUserIdWithPermissions("viewer", "owner", {
            hasCustomCover: true,
        });

        const [{ where }] = repository.findAndCount.mock.calls[0] as [
            { where: Record<string, unknown> },
        ];
        expect(where).toEqual(
            expect.objectContaining({
                libraryUserId: "owner",
                visibility: In([LibraryVisibility.Public]),
                gameId: In([7]),
            }),
        );
        expect(where).not.toHaveProperty("collectionsMap");
    });

    test("selects period entries by creation and activity dates, not by last edit", async () => {
        const { service, repository } = fixture();
        const startDate = new Date("2026-01-01T00:00:00Z");
        const endDate = new Date("2026-12-31T23:59:59Z");

        await service.findAllByUserIdInPeriod("owner", {
            startDate,
            endDate,
        });

        const [{ where }] = repository.find.mock.calls[0] as [
            { where: Record<string, unknown>[] },
        ];
        expect(
            where.map((condition) =>
                Object.keys(condition).find((key) => key !== "libraryUserId"),
            ),
        ).toEqual([
            "createdAt",
            "startedAt",
            "finishedAt",
            "droppedAt",
            "plannedAt",
        ]);
        expect(
            where.every((condition) => condition.libraryUserId === "owner"),
        ).toBe(true);
        expect(
            where.every((condition) => !("updatedAt" in condition)),
        ).toBe(true);
    });
});

describe("library search filter", () => {
    test("leaves each listing unchanged without search", async () => {
        const library = fixture();
        await library.service.findAllByUserIdWithPermissions(
            "viewer",
            "owner",
            {},
        );
        const [libraryCall] = library.repository.findAndCount.mock.calls[0] as [
            { where: Record<string, unknown> },
        ];
        expect(libraryCall.where.gameId).toBeUndefined();

        const favorites = fixture();
        await favorites.service.findFavoritesByUserId("viewer", "owner", {});
        const [favoriteCall] = favorites.repository.findAndCount.mock
            .calls[0] as [{ where: Record<string, unknown> }];
        expect(favoriteCall.where.gameId).toBeUndefined();

        const collection = fixture();
        collection.collectionsService.findOneById.mockResolvedValue({
            id: "collection",
            libraryUserId: "owner",
            isPublic: true,
        });
        await collection.service.findAllByCollectionIdWithPermissions(
            "viewer",
            "collection",
            {},
        );
        const [collectionCall] = collection.repository.findAndCount.mock
            .calls[0] as [{ where: Record<string, unknown> }];
        expect(collectionCall.where.gameId).toBeUndefined();
    });

    test("treats a blank search as no filter", async () => {
        const { service, repository } = fixture();

        await service.findAllByUserIdWithPermissions("owner", "owner", {
            search: "   ",
        });

        expect(repository.findAndCount).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ gameId: undefined }),
            }),
        );
    });

    test.each(["%%%", "'", "_"])(
        "returns an empty page for %p when normalization leaves nothing",
        async (search) => {
            const { service, repository, userGameCovers, libraryAccess } =
                fixture();

            await expect(
                service.findAllByUserIdWithPermissions("owner", "owner", {
                    search,
                    hasCustomCover: true,
                }),
            ).resolves.toEqual([[], 0]);
            expect(repository.findAndCount).not.toHaveBeenCalled();
            expect(userGameCovers.find).not.toHaveBeenCalled();
            expect(libraryAccess.resolve).not.toHaveBeenCalled();
        },
    );

    test("binds the normalized term as a Raw parameter", async () => {
        const { service, repository } = fixture();

        await service.findAllByUserIdWithPermissions("owner", "owner", {
            search: "Half-Life",
        });

        const [{ where }] = repository.findAndCount.mock.calls[0] as [
            { where: Record<string, unknown> },
        ];
        const searchCondition = where.gameId as any;
        expect(searchCondition.type).toBe("raw");
        expect(searchCondition.objectLiteralParameters).toEqual({
            librarySearch: "%Half Life%",
        });
        const sql = searchCondition.getSql("ce.gameId");
        expect(sql).toContain("g.id = ce.gameId");
        expect(sql).toContain("a.gameId = ce.gameId");
        expect(sql).not.toContain("Half Life");
    });

    test("combines search and the custom cover ids with And", async () => {
        const { service, repository, userGameCovers } = fixture();
        userGameCovers.find.mockResolvedValue([{ gameId: 7 }]);

        await service.findAllByUserIdWithPermissions("owner", "owner", {
            search: "halo",
            hasCustomCover: true,
        });

        const [{ where }] = repository.findAndCount.mock.calls[0] as [
            { where: Record<string, unknown> },
        ];
        const condition = where.gameId as any;
        expect(condition.type).toBe("and");
        expect(condition.value.map((child: any) => child.type)).toEqual([
            "in",
            "raw",
        ]);
        expect(condition.value[0].value).toEqual([7]);
        expect(condition.value[1].objectLiteralParameters).toEqual({
            librarySearch: "%halo%",
        });
    });
});

describe("entry visibility writes", () => {
    const dto = (extra: Record<string, unknown> = {}) => ({
        gameId: 7,
        status: CollectionEntryStatus.PLANNED,
        collectionIds: [],
        platformIds: [6],
        ...extra,
    });

    test("creates a public entry when no level is sent", async () => {
        const { service, repository } = fixture();

        await service.createOrUpdate("owner", dto());

        expect(repository.save).toHaveBeenCalledWith(
            expect.objectContaining({
                gameId: 7,
                visibility: LibraryVisibility.Public,
            }),
        );
    });

    test("creates the entry with the level that was sent", async () => {
        const { service, repository } = fixture();

        await service.createOrUpdate(
            "owner",
            dto({ visibility: LibraryVisibility.Followers }),
        );

        expect(repository.save).toHaveBeenCalledWith(
            expect.objectContaining({
                visibility: LibraryVisibility.Followers,
            }),
        );
    });

    test("an update without a level keeps the stored one", async () => {
        const { service, repository, notifications } = fixture({
            id: "entry",
            visibility: LibraryVisibility.Private,
        });

        await service.createOrUpdate("owner", dto());

        expect(repository.save).toHaveBeenCalledWith(
            expect.objectContaining({
                visibility: LibraryVisibility.Private,
            }),
        );
        expect(notifications.invalidateLibraryContent).not.toHaveBeenCalled();
    });

    test("a newly created related entry inherits the parent's level", async () => {
        const { service, repository } = fixture();

        await service.createOrUpdate(
            "owner",
            dto({
                visibility: LibraryVisibility.Private,
                relatedGameIds: [2],
            }),
        );

        expect(repository.save.mock.calls[1][0]).toMatchObject({
            gameId: 2,
            visibility: LibraryVisibility.Private,
        });
    });

    test("an existing related entry keeps its own level", async () => {
        const { service, repository } = fixture();
        repository.findOne
            .mockResolvedValueOnce({
                id: "entry",
                visibility: LibraryVisibility.Followers,
            })
            .mockResolvedValueOnce({
                id: "dlc",
                gameId: 2,
                visibility: LibraryVisibility.Private,
            });

        await service.createOrUpdate(
            "owner",
            dto({
                visibility: LibraryVisibility.Public,
                relatedGameIds: [2],
            }),
        );

        expect(repository.save).toHaveBeenCalledTimes(1);
        expect(repository.save.mock.calls[0][0]).toMatchObject({
            id: "entry",
            visibility: LibraryVisibility.Public,
        });
    });

    test("rejects an unknown visibility level before writing", async () => {
        const errors = await validate(
            plainToInstance(CreateUpdateCollectionEntryDto, {
                ...dto(),
                visibility: "friends",
            }),
        );

        expect(errors.map((error) => error.property)).toEqual(["visibility"]);
    });

    test("accepts the known visibility levels", async () => {
        for (const visibility of Object.values(LibraryVisibility)) {
            const errors = await validate(
                plainToInstance(CreateUpdateCollectionEntryDto, {
                    ...dto(),
                    visibility,
                }),
            );
            expect(errors).toEqual([]);
        }
    });

    test("changing the visibility updates only the column, with no side effects", async () => {
        const { service, repository, activities, achievements, levels } =
            fixture({ id: "entry", visibility: LibraryVisibility.Public });

        await service.changeVisibility("owner", 7, LibraryVisibility.Private);

        expect(repository.update).toHaveBeenCalledWith(
            { id: "entry" },
            { visibility: LibraryVisibility.Private },
        );
        expect(activities.register).not.toHaveBeenCalled();
        expect(levels.registerLevelExpIncreaseActivity).not.toHaveBeenCalled();
        expect(achievements.addTrackingJob).not.toHaveBeenCalled();
    });

    test("changing the visibility of a game outside the library returns 404", async () => {
        const { service, repository } = fixture();

        const error = await service
            .changeVisibility("owner", 7, LibraryVisibility.Private)
            .catch((thrown) => thrown);

        expect(error.getStatus()).toBe(404);
        expect(repository.update).not.toHaveBeenCalled();
    });

    test("does nothing when the level is unchanged", async () => {
        const { service, repository, notifications } = fixture({
            id: "entry",
            visibility: LibraryVisibility.Private,
        });

        await service.changeVisibility("owner", 7, LibraryVisibility.Private);

        expect(repository.update).not.toHaveBeenCalled();
        expect(notifications.invalidateLibraryContent).not.toHaveBeenCalled();
    });

    test("invalidates library content only when the level becomes stricter", async () => {
        const stricter = fixture({
            id: "entry",
            visibility: LibraryVisibility.Public,
        });
        await stricter.service.changeVisibility(
            "owner",
            7,
            LibraryVisibility.Private,
        );
        expect(
            stricter.notifications.invalidateLibraryContent,
        ).toHaveBeenCalledWith("owner", "entry");

        const looser = fixture({
            id: "entry",
            visibility: LibraryVisibility.Private,
        });
        await looser.service.changeVisibility(
            "owner",
            7,
            LibraryVisibility.Public,
        );
        expect(
            looser.notifications.invalidateLibraryContent,
        ).not.toHaveBeenCalled();
    });
});

describe("library listing visibility", () => {
    test("a visitor lists public entries without a collection condition", async () => {
        const { service, repository } = fixture();

        await service.findAllByUserIdWithPermissions("viewer", "owner", {});

        const [{ where }] = repository.findAndCount.mock.calls[0] as [
            { where: Record<string, unknown> },
        ];
        expect(where).toEqual(
            expect.objectContaining({
                libraryUserId: "owner",
                visibility: In([LibraryVisibility.Public]),
            }),
        );
        expect(where).not.toHaveProperty("collectionsMap");
    });

    test("a follower also lists followers entries", async () => {
        const { service, repository } = fixture(
            undefined,
            [],
            FOLLOWER_ACCESS,
        );

        await service.findAllByUserIdWithPermissions("follower", "owner", {});

        expect(repository.findAndCount).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    visibility: In([
                        LibraryVisibility.Public,
                        LibraryVisibility.Followers,
                    ]),
                }),
            }),
        );
    });

    test("returns an empty page when the library is hidden", async () => {
        const { service, repository, libraryAccess } = fixture(
            undefined,
            [],
            HIDDEN_ACCESS,
        );

        await expect(
            service.findAllByUserIdWithPermissions("viewer", "owner", {}),
        ).resolves.toEqual([[], 0]);
        expect(libraryAccess.resolve).toHaveBeenCalledWith("viewer", "owner");
        expect(repository.findAndCount).not.toHaveBeenCalled();
    });

    test("keeps the totals of status and custom cover filters", async () => {
        const { service, repository, userGameCovers } = fixture();
        userGameCovers.find.mockResolvedValue([{ gameId: 7 }]);
        repository.findAndCount.mockResolvedValue([
            [entryWithCollections("owner", true)],
            3,
        ]);

        const result = await service.findAllByUserIdWithPermissions(
            "viewer",
            "owner",
            {
                status: CollectionEntryStatus.FINISHED,
                hasCustomCover: true,
            },
        );

        expect(result[1]).toBe(3);
        expect(repository.findAndCount).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    status: CollectionEntryStatus.FINISHED,
                    visibility: In([LibraryVisibility.Public]),
                    gameId: In([7]),
                }),
            }),
        );
    });

    test("removes private collections from an entry for a visitor", async () => {
        const { service, repository } = fixture();
        repository.findAndCount.mockResolvedValue([
            [entryWithCollections("owner", true, false)],
            1,
        ]);

        const [entries] = await service.findAllByUserIdWithPermissions(
            "viewer",
            "owner",
            {},
        );

        expect(entries[0].collections.map((collection) => collection.isPublic))
            .toEqual([true]);
    });

    test("keeps every collection and level for the owner", async () => {
        const { service, repository } = fixture();
        repository.findAndCount.mockResolvedValue([
            [entryWithCollections("owner", true, false)],
            1,
        ]);

        const [entries] = await service.findAllByUserIdWithPermissions(
            "owner",
            "owner",
            {},
        );

        expect(entries[0].collections).toHaveLength(2);
        expect(repository.findAndCount).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    visibility: In([
                        LibraryVisibility.Public,
                        LibraryVisibility.Followers,
                        LibraryVisibility.Private,
                    ]),
                }),
            }),
        );
    });

    test("favorites follow the same visibility rule", async () => {
        const { service, repository } = fixture(
            undefined,
            [],
            FOLLOWER_ACCESS,
        );
        repository.findAndCount.mockResolvedValue([
            [entryWithCollections("owner", false)],
            1,
        ]);

        const [entries, total] = await service.findFavoritesByUserId(
            "follower",
            "owner",
            { status: CollectionEntryStatus.PLAYING },
        );

        expect(total).toBe(1);
        expect(entries[0].collections).toEqual([]);
        expect(repository.findAndCount).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    isFavorite: true,
                    libraryUserId: "owner",
                    status: CollectionEntryStatus.PLAYING,
                    visibility: In([
                        LibraryVisibility.Public,
                        LibraryVisibility.Followers,
                    ]),
                }),
            }),
        );
    });
});

describe("single-entry reads for a viewer", () => {
    test("a hidden entry returns the same 404 as a missing one", async () => {
        const hidden = fixture(
            {
                id: "entry",
                libraryUserId: "owner",
                visibility: LibraryVisibility.Private,
            },
            [],
            PUBLIC_ACCESS,
        );
        const missing = fixture(undefined, [], PUBLIC_ACCESS);

        const hiddenError = await hidden.service
            .findOneByIdForViewer("viewer", "entry")
            .catch((thrown) => thrown);
        const missingError = await missing.service
            .findOneByIdForViewer("viewer", "entry")
            .catch((thrown) => thrown);

        expect(hiddenError.getStatus()).toBe(404);
        expect(hiddenError.getResponse()).toBe("No entry found.");
        expect(missingError.getStatus()).toBe(hiddenError.getStatus());
        expect(missingError.getResponse()).toEqual(hiddenError.getResponse());
    });

    test("a hidden entry by game returns 404", async () => {
        const { service } = fixture(
            {
                id: "entry",
                libraryUserId: "owner",
                visibility: LibraryVisibility.Followers,
            },
            [],
            PUBLIC_ACCESS,
        );

        const error = await service
            .findOneByUserIdAndGameIdForViewer("viewer", "owner", 7)
            .catch((thrown) => thrown);

        expect(error.getStatus()).toBe(404);
        expect(error.getResponse()).toBe("Collection entry not found.");
    });

    test("a visible entry lists no private collections for a visitor", async () => {
        const visibleEntry = entryWithCollections("owner", true, false);
        visibleEntry.id = "entry";
        visibleEntry.visibility = LibraryVisibility.Public;
        const { service } = fixture(visibleEntry, [], PUBLIC_ACCESS);

        const entry = await service.findOneByIdForViewer("viewer", "entry");

        expect(entry.collections.map((collection) => collection.isPublic))
            .toEqual([true]);
    });
});
