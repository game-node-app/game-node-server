import { ActivityType } from "../../activities/activities-queue/activities-queue.constants";
import { ObtainedGameAchievementActivity } from "./entity/obtained-game-achievement-activity.entity";
import { GameAchievementActivityService } from "./game-achievement-activity.service";

test("transactional activity persistence publishes only when requested after commit", async () => {
    const activity = { id: 5, profileUserId: "user" } as any;
    const repository = {
        save: jest.fn().mockResolvedValue(activity),
        update: jest.fn(),
    };
    const manager = { getRepository: jest.fn(() => repository) };
    const register = jest.fn();
    const service = new GameAchievementActivityService(
        repository as any,
        {} as any,
        { register } as any,
    );

    const persisted = await service.save(
        { profileUserId: "user" } as any,
        manager as any,
    );

    expect(manager.getRepository).toHaveBeenCalledWith(
        ObtainedGameAchievementActivity,
    );
    expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ pendingDelivery: true }),
    );
    expect(register).not.toHaveBeenCalled();

    await service.publish(persisted);
    expect(register).toHaveBeenCalledWith({
        sourceId: activity.id,
        profileUserId: "user",
        type: ActivityType.OBTAINED_GAME_ACHIEVEMENT,
    }, `activity-${ActivityType.OBTAINED_GAME_ACHIEVEMENT}-${activity.id}`);
    expect(repository.update).toHaveBeenCalledWith(activity.id, {
        pendingDelivery: false,
    });
});

test("queue rejection leaves activity pending", async () => {
    const error = new Error("queue unavailable");
    const repository = { update: jest.fn() };
    const service = new GameAchievementActivityService(
        repository as any,
        {} as any,
        { register: jest.fn().mockRejectedValue(error) } as any,
    );

    await expect(
        service.publish({
            id: 5,
            profileUserId: "user",
            pendingDelivery: true,
        } as ObtainedGameAchievementActivity),
    ).rejects.toThrow("queue unavailable");
    expect(repository.update).not.toHaveBeenCalled();
});

test("activity reads omit the internal pending-delivery marker", async () => {
    const repository = {
        findOneOrFail: jest.fn().mockResolvedValue({
            id: 5,
            pendingDelivery: true,
            externalGameId: 1,
            externalGame: { gameId: 10 },
            obtainedGameAchievements: [],
        }),
    };
    const service = new GameAchievementActivityService(
        repository as any,
        { findAllByExternalGameId: jest.fn().mockResolvedValue([]) } as any,
        {} as any,
    );

    await expect(service.findOneByIdOrFail(5)).resolves.not.toHaveProperty(
        "pendingDelivery",
    );
});
