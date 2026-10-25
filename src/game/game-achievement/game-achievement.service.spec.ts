import { GameAchievementService } from "./game-achievement.service";
import { EGameExternalGameCategory } from "../game-repository/game-repository.constants";
import { ProviderSyncError } from "../../sync/provider-sync.error";
import { getPSNAchievementId } from "./game-achievement.utils";
import { UnsupportedGameAchievementSourceError } from "./game-achievement.errors";

test("unsupported external categories keep the shared HTTP 400 failure", async () => {
    const service = new GameAchievementService(
        {
            findOneByIdOrFail: jest.fn().mockResolvedValue({
                id: 10,
                uid: "unknown",
                category: "unsupported",
            }),
        } as any,
        {} as any,
        {} as any,
        {} as any,
        { getGamePlatformsMap: jest.fn().mockResolvedValue(new Map()) } as any,
    );

    const request = service.findAllByExternalGameId(10);
    await expect(request).rejects.toBeInstanceOf(
        UnsupportedGameAchievementSourceError,
    );
    await expect(request).rejects.toMatchObject({ status: 400 });
});

test("unsupported Steam schemas preserve the existing no-achievements response without a rarity request", async () => {
    const getAchievementsPercentage = jest.fn();
    const service = new GameAchievementService(
        {
            findOneByIdOrFail: jest.fn().mockResolvedValue({
                id: 1,
                uid: "10",
                category: EGameExternalGameCategory.Steam,
            }),
        } as any,
        {
            getAvailableAchievements: jest
                .fn()
                .mockRejectedValue(
                    new ProviderSyncError("unsupported", "No schema"),
                ),
            getAchievementsPercentage,
        } as any,
        {} as any,
        {} as any,
        { getGamePlatformsMap: jest.fn().mockResolvedValue(new Map()) } as any,
    );
    await expect(service.findAllByExternalGameId(1)).rejects.toMatchObject({
        status: 404,
    });
    await expect(
        service.findAllByExternalGameIdForSync(1),
    ).rejects.toMatchObject({ outcome: "unsupported" });
    expect(getAchievementsPercentage).not.toHaveBeenCalled();
});

test("completion catalogue skips rarity and platform presentation data while display retains it", async () => {
    const getAvailableAchievements = jest.fn().mockResolvedValue([
        {
            name: "achievement-1",
            displayName: "Visible achievement name",
            description: "Visible description",
            icon: "visible-icon.png",
        },
    ]);
    const getAchievementsPercentage = jest
        .fn()
        .mockResolvedValue([{ name: "achievement-1", percent: "12.5" }]);
    const getGamePlatformsMap = jest
        .fn()
        .mockResolvedValue(new Map([["PC", { id: 6 }]]));
    const service = new GameAchievementService(
        {
            findOneByIdOrFail: jest.fn().mockResolvedValue({
                id: 10,
                gameId: 20,
                uid: "123",
                category: EGameExternalGameCategory.Steam,
            }),
        } as any,
        { getAvailableAchievements, getAchievementsPercentage } as any,
        {} as any,
        {} as any,
        { getGamePlatformsMap } as any,
    );

    const displayed = await service.findAllByExternalGameId(10);
    const syncSnapshot = await service.findAllByExternalGameIdForSync(10);

    expect(displayed[0]).toMatchObject({
        externalId: "achievement-1",
        name: "Visible achievement name",
        description: "Visible description",
        iconUrl: "visible-icon.png",
        steamDetails: { globalPercentage: 12.5 },
        platformIds: [6],
    });
    expect(syncSnapshot[0]).toMatchObject({ externalId: "achievement-1" });
    expect(syncSnapshot[0].steamDetails).toBeUndefined();
    expect(getAchievementsPercentage).toHaveBeenCalledTimes(1);
    expect(getGamePlatformsMap).toHaveBeenCalledTimes(1);
});

test("successful empty sync catalogue returns empty while display preserves its 404", async () => {
    const service = new GameAchievementService(
        {
            findOneByIdOrFail: jest.fn().mockResolvedValue({
                id: 10,
                uid: "123",
                category: EGameExternalGameCategory.Steam,
            }),
        } as any,
        {
            getAvailableAchievements: jest.fn().mockResolvedValue([]),
        } as any,
        {} as any,
        {} as any,
        { getGamePlatformsMap: jest.fn().mockResolvedValue(new Map()) } as any,
    );

    await expect(service.findAllByExternalGameIdForSync(10)).resolves.toEqual(
        [],
    );
    await expect(service.findAllByExternalGameId(10)).rejects.toMatchObject({
        status: 404,
    });
});

test("available PSN trophies fetch each communication and service mapping once", async () => {
    const mappings = [
        { npCommunicationId: "comm-a", npServiceName: "trophy" },
        { npCommunicationId: "comm-b", npServiceName: "trophy" },
        { npCommunicationId: "comm-a", npServiceName: "trophy" },
    ];
    const getGameAchievements = jest.fn(async (npCommunicationId: string) => [
        {
            trophyId: 1,
            trophyIconUrl: `${npCommunicationId}.png`,
            trophyName: npCommunicationId,
            trophyType: "bronze",
        },
    ]);
    const service = new GameAchievementService(
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
        { getGameAchievements } as any,
        {} as any,
        { getGamePlatformsMap: jest.fn().mockResolvedValue(new Map()) } as any,
    );

    const achievements = await service.findAllByExternalGameId(10);

    expect(getGameAchievements.mock.calls).toEqual([
        ["comm-a", "trophy"],
        ["comm-b", "trophy"],
    ]);
    expect(achievements.map((item) => item.externalId)).toEqual([
        getPSNAchievementId("comm-a", 1),
        getPSNAchievementId("comm-b", 1),
    ]);
});
