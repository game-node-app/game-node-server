import { TypeORMError } from "typeorm";
import { ActivityType } from "../activities-queue/activities-queue.constants";
import { ActivitiesRepositoryService } from "./activities-repository.service";

const delivery = {
    type: ActivityType.OBTAINED_GAME_ACHIEVEMENT,
    sourceId: 12,
    profileUserId: "user",
};

function makeService(repository: any, statistics = { createStatistics: jest.fn() }) {
    return new ActivitiesRepositoryService(
        repository,
        statistics as any,
        {} as any,
        {} as any,
        { isMature: jest.fn().mockResolvedValue(false) } as any,
        { checkIsSuspendedOrBanned: jest.fn().mockResolvedValue(false) } as any,
        {} as any,
        {
            findOneByIdOrFail: jest
                .fn()
                .mockResolvedValue({ externalGame: { gameId: 3 } }),
        } as any,
    );
}

test("re-delivered achievement activity jobs reuse the existing feed row", async () => {
    let stored: any;
    const repository = {
        findOneBy: jest.fn(async (where) =>
            stored?.profileUserId === where.profileUserId &&
            stored?.obtainedGameAchievementActivityId ===
                where.obtainedGameAchievementActivityId
                ? stored
                : null,
        ),
        create: jest.fn((activity) => ({ ...activity })),
        save: jest.fn(async (activity) => {
            stored = { id: "feed-row", ...activity };
            return stored;
        }),
    };
    const statistics = { createStatistics: jest.fn() };
    const service = makeService(repository, statistics);

    await service.create(delivery);
    await expect(service.create(delivery)).resolves.toBe(stored);

    expect(repository.findOneBy).toHaveBeenCalledWith({
        profileUserId: "user",
        type: delivery.type,
        obtainedGameAchievementActivityId: 12,
    });
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(statistics.createStatistics).toHaveBeenCalledTimes(1);
});

test("a concurrent duplicate insert resolves to the source activity", async () => {
    const existing = {
        id: "feed-row",
        profileUserId: "user",
        obtainedGameAchievementActivityId: 12,
    };
    const repository = {
        findOneBy: jest
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(existing),
        create: jest.fn((activity) => ({ ...activity })),
        save: jest.fn().mockRejectedValue(new TypeORMError("Duplicate entry")),
    };
    const service = makeService(repository);

    await expect(service.create(delivery)).resolves.toBe(existing);
    expect(repository.findOneBy).toHaveBeenCalledTimes(2);
    expect(repository.save).toHaveBeenCalledTimes(1);
});
