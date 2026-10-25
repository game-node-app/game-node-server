import { SteamSyncService } from "./steam-sync.service";
import { setCacheManager } from "../../utils/cacheable";
import { runPlayerSyncAttempt } from "../player-sync-attempt";

describe("Steam combined library", () => {
    const owned = jest.fn();
    const recent = jest.fn();
    const service: SteamSyncService = Object.assign(
        Object.create(SteamSyncService.prototype),
        {
            client: { getUserOwnedGames: owned, getUserRecentGames: recent },
        },
    );
    const game = (id: number, total: number, lastPlayedTimestamp?: number) => ({
        game: { id },
        total,
        lastPlayedTimestamp,
    });

    beforeEach(() => {
        jest.resetAllMocks();
        setCacheManager({
            get: jest.fn().mockResolvedValue(undefined),
            set: jest.fn().mockResolvedValue(undefined),
        } as any);
    });

    it("keeps Family Sharing, missing timestamps and distinct editions, preferring recent duplicates", async () => {
        owned.mockResolvedValue([
            game(1, 10),
            game(1, 20),
            game(2, 40, 10),
            game(4, 50),
        ]);
        recent.mockResolvedValue([game(1, 30), game(3, 60), game(3, 70)]);
        expect(await service.getLibraryGames("user")).toEqual([
            game(2, 40, 10),
            game(4, 50),
            game(1, 30),
            game(3, 70),
        ]);
        expect(owned).toHaveBeenCalledTimes(1);
        expect(recent).toHaveBeenCalledTimes(1);
    });

    it("retains the recent fallback for a valid empty owned library", async () => {
        owned.mockResolvedValue([]);
        recent.mockResolvedValue([game(3, 60)]);
        await expect(service.getLibraryGames("user")).resolves.toEqual([
            game(3, 60),
        ]);
    });

    it("accepts two complete empty lists", async () => {
        owned.mockResolvedValue([]);
        recent.mockResolvedValue([]);
        await expect(service.getLibraryGames("user")).resolves.toEqual([]);
    });

    it.each(["owned", "recent"])(
        "rejects a failed/private required %s response",
        async (failed) => {
            owned.mockResolvedValue([game(1, 10)]);
            recent.mockResolvedValue([game(2, 20)]);
            const error = new Error("private or unavailable");
            (failed === "owned" ? owned : recent).mockRejectedValue(error);
            await expect(service.getLibraryGames("user")).rejects.toMatchObject(
                { outcome: "failed", cause: error },
            );
        },
    );
});

describe("Steam achievement outcomes", () => {
    const schema = jest.fn();
    const obtained = jest.fn();
    const service: SteamSyncService = Object.assign(
        Object.create(SteamSyncService.prototype),
        {
            client: { getGameSchema: schema, getUserAchievements: obtained },
        },
    );
    beforeEach(() => {
        jest.resetAllMocks();
        setCacheManager({
            get: jest.fn().mockResolvedValue(undefined),
            set: jest.fn().mockResolvedValue(undefined),
        } as any);
    });
    it("distinguishes unsupported schemas from complete empty catalogues", async () => {
        schema.mockResolvedValueOnce({}).mockResolvedValueOnce({
            availableGameStats: { achievements: [] },
        });
        await expect(service.getAvailableAchievements(1)).rejects.toMatchObject(
            { outcome: "unsupported" },
        );
        await expect(service.getAvailableAchievements(1)).resolves.toEqual([]);
    });
    it.each([undefined, { availableGameStats: {} }])(
        "rejects malformed schemas",
        async (response) => {
            schema.mockResolvedValue(response);
            await expect(
                service.getAvailableAchievements(1),
            ).rejects.toMatchObject({ outcome: "incomplete" });
        },
    );
    it("distinguishes complete empty obtained results from malformed ones", async () => {
        schema.mockResolvedValue({ availableGameStats: { achievements: [] } });
        obtained
            .mockResolvedValueOnce({ achievements: [] })
            .mockResolvedValueOnce({});
        await expect(service.getUserAchievements("user", 1)).resolves.toEqual({
            achievements: [],
        });
        await expect(
            service.getUserAchievements("user", 1),
        ).rejects.toMatchObject({ outcome: "incomplete" });
    });

    it("shares one cold schema fetch across concurrent consumers and evicts failed attempts", async () => {
        const response = { availableGameStats: { achievements: [] } };
        schema.mockRejectedValueOnce(new Error("temporary"));
        schema.mockResolvedValue(response);
        obtained.mockResolvedValue({ achievements: [] });

        await runPlayerSyncAttempt(async () => {
            const failures = await Promise.allSettled([
                service.getUserAchievements("user", 1),
                service.getAvailableAchievements(1),
            ]);
            expect(
                failures.every((result) => result.status === "rejected"),
            ).toBe(true);
            expect(schema).toHaveBeenCalledTimes(1);
            expect(obtained).not.toHaveBeenCalled();

            await expect(
                Promise.all([
                    service.getUserAchievements("user", 1),
                    service.getAvailableAchievements(1),
                ]),
            ).resolves.toEqual([{ achievements: [] }, []]);
            expect(schema).toHaveBeenCalledTimes(2);
            expect(obtained).toHaveBeenCalledTimes(1);
        });
        await runPlayerSyncAttempt(() => service.getAvailableAchievements(1));
        expect(schema).toHaveBeenCalledTimes(3);
    });
});
