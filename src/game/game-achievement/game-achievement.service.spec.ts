import { GameAchievementService } from "./game-achievement.service";
import { EGameExternalGameCategory } from "../game-repository/game-repository.constants";
import { ProviderSyncError } from "../../sync/provider-sync.error";
import { getPSNAchievementId } from "./game-achievement.utils";
import { UnsupportedGameAchievementSourceError } from "./game-achievement.errors";

/** In-memory stand-in for the catalog table. */
function catalogRepository(rows = new Map<number, any>()) {
    return {
        rows,
        findOneBy: jest.fn(
            async ({ externalGameId }) => rows.get(externalGameId) ?? null,
        ),
        findBy: jest.fn(async ({ externalGameId }) =>
            [...rows.values()].filter((row) =>
                externalGameId.value.includes(row.externalGameId),
            ),
        ),
        upsert: jest.fn(async (row) => void rows.set(row.externalGameId, row)),
    } as any;
}

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
        {} as any,
        {} as any,
        catalogRepository(),
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
        {} as any,
        {} as any,
        catalogRepository(),
    );
    await expect(service.findAllByExternalGameId(1)).rejects.toMatchObject({
        status: 404,
    });
    await expect(
        service.findAllByExternalGameIdForSync(1, "test-user"),
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
        {} as any,
        {} as any,
        catalogRepository(),
    );

    const displayed = await service.findAllByExternalGameId(10);
    const syncSnapshot = await service.findAllByExternalGameIdForSync(
        10,
        "test-user",
    );

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
        {} as any,
        {} as any,
        catalogRepository(),
    );

    await expect(
        service.findAllByExternalGameIdForSync(10, "test-user"),
    ).resolves.toEqual([]);
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
        {} as any,
        {} as any,
        catalogRepository(),
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

describe("GOG catalogue account context", () => {
    const game = {
        id: 5,
        gameId: 10,
        uid: "100",
        category: EGameExternalGameCategory.Gog,
    };
    const snapshot = [
        {
            achievement_id: "a",
            visible: true,
            name: "Title",
            description: "Description",
            image_url_unlocked: "https://images.gog.com/a.png",
            date_unlocked: "2026-01-01T00:00:00Z",
        },
        {
            achievement_id: "hidden",
            visible: false,
            name: "Private",
            description: "Secret",
            image_url_unlocked: "https://images.gog.com/h.png",
            date_unlocked: null,
        },
    ];
    const build = () => {
        const gog = {
            getAchievements: jest.fn(async () => snapshot),
            getCatalogueAchievements: jest.fn(async () => snapshot),
        };
        const connections = {
            findOneByUserIdAndType: jest.fn(async (user: string) => ({
                sourceUserId: user === "one" ? "123" : "456",
            })),
        };
        const service = new GameAchievementService(
            {
                findOneByIdOrFail: async () => game,
                findAllForGameId: async () => [game],
            } as any,
            {} as any,
            {} as any,
            {} as any,
            { getGamePlatformsMap: async () => new Map() } as any,
            gog as any,
            connections as any,
            catalogRepository(),
        );
        return { service, gog, connections };
    };
    it("projects only catalogue fields, preserves hidden text and groups under GOG", async () => {
        const { service, gog } = build();
        const result = await service.findAllByExternalGameId(5);
        expect(result[0]).toMatchObject({
            externalId: "a",
            source: 5,
            platformIds: [6],
            name: "Title",
        });
        expect(result[0]).not.toHaveProperty("date_unlocked");
        expect(result[1]).toMatchObject({
            externalId: "hidden",
            name: "Private",
            description: "Secret",
        });
        expect(gog.getCatalogueAchievements).toHaveBeenCalledWith("100");
        expect((await service.findAllByGameId(10))[0]).toMatchObject({
            source: 5,
            sourceName: "GOG",
            iconName: "gog",
        });
    });
    it("uses each syncing user's account and never a random catalogue account", async () => {
        const { service, gog } = build();
        const result = await service.findAllByExternalGameIdForSync(5, "one");
        expect(result[1]).toMatchObject({
            externalId: "hidden",
            name: "Private",
            description: "Secret",
        });
        await service.findAllByExternalGameIdForSync(5, "two");
        expect(gog.getAchievements.mock.calls).toEqual([
            ["123", "100"],
            ["456", "100"],
        ]);
        expect(gog.getCatalogueAchievements).not.toHaveBeenCalled();
    });
    it("does not turn unavailable catalogue credentials into an empty success", async () => {
        const { service, gog } = build();
        gog.getCatalogueAchievements.mockRejectedValueOnce(
            new Error("no usable account"),
        );
        await expect(service.findAllByExternalGameId(5)).rejects.toThrow(
            "no usable account",
        );
    });
});

describe("stored achievement catalog", () => {
    const steamGame = (id: number) => ({
        id,
        gameId: id * 10,
        uid: String(id),
        category: EGameExternalGameCategory.Steam,
    });
    const build = (catalogs = catalogRepository()) => {
        const getAvailableAchievements = jest.fn(async (appId: number) =>
            appId === 404
                ? []
                : appId === 500
                  ? Promise.reject(new Error("store down"))
                  : [{ name: `a${appId}`, displayName: "A", icon: "i" }],
        );
        const service = new GameAchievementService(
            { findOneByIdOrFail: async (id: number) => steamGame(id) } as any,
            {
                getAvailableAchievements,
                getAchievementsPercentage: async () => [],
            } as any,
            {} as any,
            {} as any,
            { getGamePlatformsMap: async () => new Map() } as any,
            {} as any,
            {} as any,
            catalogs,
        );
        return { service, catalogs, getAvailableAchievements };
    };

    it("asks the store once, then serves the stored list, including a store with none", async () => {
        const { service, getAvailableAchievements } = build();
        await service.findAllByExternalGameId(1);
        await service.findAllByExternalGameId(1);
        for (let i = 0; i < 2; i++)
            await expect(
                service.findAllByExternalGameId(404),
            ).rejects.toMatchObject({ status: 404 });
        expect(getAvailableAchievements.mock.calls).toEqual([[1], [404]]);
    });

    it("serves a stale catalog right away and refreshes it in the background", async () => {
        const catalogs = catalogRepository();
        catalogs.rows.set(1, {
            externalGameId: 1,
            achievements: [{ externalId: "old" }],
            fetchedAt: new Date(Date.now() - 25 * 3_600_000),
        });
        const { service, getAvailableAchievements } = build(catalogs);
        await expect(service.findAllByExternalGameId(1)).resolves.toEqual([
            { externalId: "old" },
        ]);
        await new Promise((r) => setTimeout(r, 0));
        expect(getAvailableAchievements).toHaveBeenCalledWith(1);
        expect(catalogs.rows.get(1).achievements[0].externalId).toBe("a1");
    });

    it("reads many games in one query, fetches the missing ones and leaves out failed or empty ones", async () => {
        const catalogs = catalogRepository();
        catalogs.rows.set(2, {
            externalGameId: 2,
            achievements: [{ externalId: "stored" }],
            fetchedAt: new Date(),
        });
        const { service, getAvailableAchievements } = build(catalogs);
        const result = await service.findAllByExternalGameIds([1, 2, 404, 500]);
        expect([...result.keys()].sort()).toEqual([1, 2]);
        expect(catalogs.findBy).toHaveBeenCalledTimes(1);
        expect(getAvailableAchievements.mock.calls.flat().sort()).toEqual([
            1, 404, 500,
        ]);
        // A failed store isn't kept, so the next read tries it again.
        expect(catalogs.rows.has(500)).toBe(false);
    });
});
