import { CollectionEntryStatus } from "./collections-entries.constants";
jest.mock("typeorm-transactional", () => ({
    Transactional:
        () =>
        (_target: object, _name: string, descriptor: PropertyDescriptor) =>
            descriptor,
}));
import { CollectionsEntriesService } from "./collections-entries.service";
import { Library } from "../../libraries/entities/library.entity";

function fixture(existing?: any) {
    const lock = jest.fn().mockResolvedValue({ userId: "owner" });
    const achievements = { addTrackingJob: jest.fn() };
    const repository = {
        findOne: jest.fn().mockResolvedValue(existing),
        save: jest.fn(async (row) => ({ ...row, id: "entry" })),
        update: jest.fn(),
        manager: { getRepository: jest.fn(() => ({ findOne: lock })) },
    };
    const service = new CollectionsEntriesService(
        repository as any,
        {} as any,
        { register: jest.fn() } as any,
        achievements as any,
        { registerLevelExpIncreaseActivity: jest.fn() } as any,
        { findAllByIds: jest.fn().mockResolvedValue([]) } as any,
        {} as any,
    );
    jest.spyOn(service as any, "updateAssociatedCollections").mockResolvedValue(
        undefined,
    );
    return { service, repository, lock, achievements };
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
