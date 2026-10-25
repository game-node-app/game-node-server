import { GameCompletionStatus } from "./entity/game-completion-status.entity";
import { GameAchievementStatusService } from "./game-achievement-status.service";
import { generateChecksum } from "../../utils/checksum";

const checksumFor = (status: Partial<GameCompletionStatus>) =>
    generateChecksum({
        externalGameId: status.externalGameId,
        profileUserId: status.profileUserId,
        isCompleted: status.isCompleted,
        isPlatinumObtained: status.isPlatinumObtained,
        totalAvailableAchievements: status.totalAvailableAchievements,
        totalObtainedAchievements: status.totalObtainedAchievements,
    });

test("completion status uses the supplied transaction manager", async () => {
    const repository = {
        create: jest.fn((row) => row),
        findOneBy: jest.fn().mockResolvedValue(null),
        save: jest.fn(),
    };
    const manager = { getRepository: jest.fn(() => repository) };
    const rootRepository = {
        create: jest.fn(),
        findOneBy: jest.fn(),
        save: jest.fn(),
    };
    const service = new GameAchievementStatusService(rootRepository as any);

    await service.updateGameCompletionStatus(
        "user",
        10,
        [{ externalId: "achievement-1" }] as any,
        [
            {
                externalId: "achievement-1",
                isObtained: true,
                obtainedAt: new Date("2026-10-25T00:00:00Z"),
            },
        ] as any,
        manager as any,
    );

    expect(manager.getRepository).toHaveBeenCalledWith(GameCompletionStatus);
    expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
            externalGameId: 10,
            profileUserId: "user",
            isCompleted: true,
            totalAvailableAchievements: 1,
            totalObtainedAchievements: 1,
        }),
    );
    expect(rootRepository.save).not.toHaveBeenCalled();
});

test("unchanged reconciliation preserves the completed timestamp and skips a write", async () => {
    const completedAt = new Date("2024-05-06T00:00:00Z");
    const existing = {
        externalGameId: 10,
        profileUserId: "user",
        isCompleted: true,
        isPlatinumObtained: false,
        totalAvailableAchievements: 1,
        totalObtainedAchievements: 1,
        completedAt,
    };
    const repository = {
        create: jest.fn((row) => row),
        findOneBy: jest
            .fn()
            .mockResolvedValue({
                ...existing,
                checksum: checksumFor(existing),
            }),
        save: jest.fn(),
    };
    const service = new GameAchievementStatusService(repository as any);

    await service.updateGameCompletionStatus(
        "user",
        10,
        [{ externalId: "one" }] as any,
        [
            {
                externalId: "one",
                isObtained: true,
                obtainedAt: completedAt,
            },
        ] as any,
    );

    expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ isCompleted: true, completedAt }),
    );
    expect(repository.save).not.toHaveBeenCalled();
});

test("changed complete catalogue counts preserve the original completion timestamp", async () => {
    const completedAt = new Date("2024-05-06T00:00:00Z");
    const existing = {
        externalGameId: 10,
        profileUserId: "user",
        isCompleted: true,
        isPlatinumObtained: false,
        totalAvailableAchievements: 1,
        totalObtainedAchievements: 1,
        completedAt,
    };
    const repository = {
        create: jest.fn((row) => row),
        findOneBy: jest
            .fn()
            .mockResolvedValue({
                ...existing,
                checksum: checksumFor(existing),
            }),
        save: jest.fn(),
    };
    const service = new GameAchievementStatusService(repository as any);

    await service.updateGameCompletionStatus(
        "user",
        10,
        [{ externalId: "one" }, { externalId: "two" }] as any,
        [
            {
                externalId: "one",
                isObtained: true,
                obtainedAt: completedAt,
            },
            {
                externalId: "two",
                isObtained: true,
                obtainedAt: completedAt,
            },
        ] as any,
    );

    expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
            totalAvailableAchievements: 2,
            totalObtainedAchievements: 2,
            isCompleted: true,
            completedAt,
        }),
    );
});

test("a real completion transition starts a new completion timestamp", async () => {
    const repository = {
        create: jest.fn((row) => row),
        findOneBy: jest.fn().mockResolvedValue({
            isCompleted: false,
            completedAt: null,
            checksum: "previous-incomplete-checksum",
        }),
        save: jest.fn(),
    };
    const service = new GameAchievementStatusService(repository as any);
    const startedAt = new Date();

    await service.updateGameCompletionStatus(
        "user",
        10,
        [{ externalId: "one" }] as any,
        [
            {
                externalId: "one",
                isObtained: true,
                obtainedAt: new Date(),
            },
        ] as any,
    );

    const saved = repository.save.mock.calls[0][0];
    expect(saved.isCompleted).toBe(true);
    expect(saved.completedAt.getTime()).toBeGreaterThanOrEqual(
        startedAt.getTime(),
    );
});

test("a complete snapshot that adds an unearned achievement clears completion", async () => {
    const repository = {
        create: jest.fn((row) => row),
        findOneBy: jest.fn().mockResolvedValue({
            isCompleted: true,
            completedAt: new Date("2024-05-06T00:00:00Z"),
            checksum: "previous-complete-checksum",
        }),
        save: jest.fn(),
    };
    const service = new GameAchievementStatusService(repository as any);

    await service.updateGameCompletionStatus(
        "user",
        10,
        [{ externalId: "one" }, { externalId: "new-dlc" }] as any,
        [
            {
                externalId: "one",
                isObtained: true,
                obtainedAt: new Date("2024-05-06T00:00:00Z"),
            },
        ] as any,
    );

    expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ isCompleted: false, completedAt: null }),
    );
});
