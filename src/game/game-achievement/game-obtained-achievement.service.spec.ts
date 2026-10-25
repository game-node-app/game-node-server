import { EConnectionType } from "../../connection/connections.constants";
import { EGameExternalGameCategory } from "../game-repository/game-repository.constants";
import { GameObtainedAchievementService } from "./game-obtained-achievement.service";
import { getPSNAchievementId } from "./game-achievement.utils";
import { UnsupportedGameAchievementSourceError } from "./game-achievement.errors";
import { ObtainedGameAchievement } from "./entity/obtained-game-achievement.entity";

test("unsupported external categories use the shared HTTP 400 failure", async () => {
    const service = new GameObtainedAchievementService(
        {} as any,
        {
            findOneByIdOrFail: jest.fn().mockResolvedValue({
                id: 10,
                category: "unsupported",
            }),
        } as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
    );

    const request = service.fetchObtainedByExternalGameId("user", 10);
    await expect(request).rejects.toBeInstanceOf(
        UnsupportedGameAchievementSourceError,
    );
    await expect(request).rejects.toMatchObject({ status: 400 });
});

test("obtained PSN trophies fetch each communication and service mapping once", async () => {
    const mappings = [
        { npCommunicationId: "comm-a", npServiceName: "trophy" },
        { npCommunicationId: "comm-b", npServiceName: "trophy" },
        { npCommunicationId: "comm-a", npServiceName: "trophy" },
    ];
    const getObtainedAchievements = jest.fn(
        async (_accountId: string, npCommunicationId: string) => [
            {
                trophyId: 1,
                earned: true,
                earnedDateTime: "2026-10-25T00:00:00Z",
                npCommunicationId,
            },
        ],
    );
    const findConnection = jest.fn().mockResolvedValue({
        sourceUserId: "source-account",
    });
    const service = new GameObtainedAchievementService(
        {} as any,
        {
            findOneByIdOrFail: jest.fn().mockResolvedValue({
                id: 10,
                gameId: 20,
                uid: "concept",
                category: EGameExternalGameCategory.PlaystationStoreUs,
                psnExtraMappings: mappings,
            }),
        } as any,
        {} as any,
        { getObtainedAchievements } as any,
        {} as any,
        { findOneByUserIdAndType: findConnection } as any,
        {} as any,
    );

    const achievements = await service.fetchObtainedByExternalGameId(
        "user",
        10,
    );

    expect(getObtainedAchievements.mock.calls).toEqual([
        ["source-account", "comm-a", "trophy"],
        ["source-account", "comm-b", "trophy"],
    ]);
    expect(achievements.map((item) => item.externalId)).toEqual([
        getPSNAchievementId("comm-a", 1),
        getPSNAchievementId("comm-b", 1),
    ]);
    expect(new Set(achievements.map((item) => item.externalId)).size).toBe(
        achievements.length,
    );
    expect(findConnection).toHaveBeenCalledWith("user", EConnectionType.PSN);
});

test("obtained rows use the supplied transaction manager", async () => {
    const repository = {
        findBy: jest.fn().mockResolvedValue([]),
        create: jest.fn((row) => row),
        save: jest.fn(async (rows) => rows),
    };
    const manager = { getRepository: jest.fn(() => repository) };
    const service = new GameObtainedAchievementService(
        { findBy: jest.fn(), create: jest.fn(), save: jest.fn() } as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
    );

    await service.persistObtainedAchievements(
        "user",
        [
            {
                externalGameId: 10,
                gameId: 20,
                externalId: "trophy-1",
                isObtained: true,
                obtainedAt: new Date("2026-10-25T00:00:00Z"),
                source: EGameExternalGameCategory.PlaystationStoreUs,
            },
        ],
        manager as any,
    );

    expect(manager.getRepository).toHaveBeenCalledWith(ObtainedGameAchievement);
    expect(repository.save).toHaveBeenCalledWith([
        expect.objectContaining({
            externalGameId: 10,
            externalAchievementId: "trophy-1",
            profileUserId: "user",
        }),
    ]);
});
