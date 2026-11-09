import { CollectionEntryStatus } from "./collections-entries.constants";
jest.mock("typeorm-transactional", () => ({
    Transactional:
        () =>
        (_target: object, _name: string, descriptor: PropertyDescriptor) =>
            descriptor,
}));
import { CollectionsEntriesService } from "./collections-entries.service";
import { Library } from "../../libraries/entities/library.entity";
import { In } from "typeorm";

function fixture(existing?: any, collections: any[] = []) {
    const lock = jest.fn().mockResolvedValue({ userId: "owner" });
    const achievements = { addTrackingJob: jest.fn() };
    const repository = {
        findOne: jest.fn().mockResolvedValue(existing),
        save: jest.fn(async (row) => ({ ...row, id: "entry" })),
        update: jest.fn(),
        findAndCount: jest.fn().mockResolvedValue([[], 0]),
        manager: { getRepository: jest.fn(() => ({ findOne: lock })) },
    };
    const collectionsService = {
        findAllByIds: jest.fn().mockResolvedValue(collections),
        findOneById: jest.fn(),
    };
    const userGameCovers = { find: jest.fn().mockResolvedValue([]) };
    const service = new CollectionsEntriesService(
        repository as any,
        {} as any,
        { register: jest.fn() } as any,
        achievements as any,
        { registerLevelExpIncreaseActivity: jest.fn() } as any,
        collectionsService as any,
        {} as any,
        userGameCovers as any,
    );
    jest.spyOn(service as any, "updateAssociatedCollections").mockResolvedValue(
        undefined,
    );
    return {
        service,
        repository,
        lock,
        achievements,
        collectionsService,
        userGameCovers,
    };
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

    test("keeps entries only in private collections hidden from another viewer", async () => {
        const { service, repository, userGameCovers } = fixture();
        userGameCovers.find.mockResolvedValue([{ gameId: 7 }]);

        await service.findAllByUserIdWithPermissions("viewer", "owner", {
            hasCustomCover: true,
        });

        expect(repository.findAndCount).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    libraryUserId: "owner",
                    collectionsMap: { collection: { isPublic: true } },
                    gameId: In([7]),
                }),
            }),
        );
    });
});
