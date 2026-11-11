import { UserConnectionDto } from "../../connection/dto/user-connection.dto";
import { EGameExternalGameCategory } from "../../game/game-repository/game-repository.constants";
import { GameExternalGame } from "../../game/external-game/entity/game-external-game.entity";
import { UserSummary } from "steamapi";
import { SUPPORTER_PREFERENCES_DEFAULTS } from "../supporter-preferences/supporter-preferences.defaults";
import { profilePresenceCacheKey } from "../supporter-preferences/supporter-preferences.cache";
import { ProfilePresenceResponseDto } from "./dto/profile-presence.dto";
import { ProfilePresenceService } from "./profile-presence.service";

function fixture() {
    const state = {
        isSupporter: true,
        preferences: {
            ...SUPPORTER_PREFERENCES_DEFAULTS,
            showLiveProfile: true,
        },
        connection: { sourceUserId: "steam-1" } as UserConnectionDto | null,
        summary: {
            gameID: 730,
            gameName: "Counter-Strike 2",
        } as UserSummary,
        mapped: [{ gameId: 42 }] as GameExternalGame[],
    };
    const billing = {
        isSupporter: jest.fn(async () => state.isSupporter),
    };
    const preferences = {
        findOrDefaults: jest.fn(async () => state.preferences),
    };
    const connections = {
        findOneByUserIdAndType: jest.fn(async () => state.connection),
    };
    const steam = {
        getUserSummary: jest.fn(async () => state.summary),
    };
    const externalGames = {
        getExternalGamesForSourceIds: jest.fn(async () => state.mapped),
    };
    const cache = new Map<string, ProfilePresenceResponseDto>();
    const cacheManager = {
        get: jest.fn(async (key: string) => cache.get(key)),
        set: jest.fn(
            async (key: string, value: ProfilePresenceResponseDto) =>
                void cache.set(key, value),
        ),
        del: jest.fn(async (key: string) => void cache.delete(key)),
    };
    const service = new ProfilePresenceService(
        billing as never,
        preferences as never,
        connections as never,
        steam as never,
        externalGames as never,
        cacheManager as never,
    );

    return {
        service,
        billing,
        preferences,
        connections,
        steam,
        externalGames,
        cacheManager,
        state,
    };
}

describe("ProfilePresenceService", () => {
    it("reports a mapped Steam game with its GameNode id", async () => {
        const { service, externalGames, cacheManager } = fixture();

        const result = await service.getPresence("user-1");

        expect(result).toEqual({
            playing: {
                source: "steam",
                name: "Counter-Strike 2",
                gameId: 42,
            },
        });
        expect(externalGames.getExternalGamesForSourceIds).toHaveBeenCalledWith(
            ["730"],
            EGameExternalGameCategory.Steam,
        );
        expect(cacheManager.set).toHaveBeenCalledWith(
            profilePresenceCacheKey("user-1"),
            result,
            60_000,
        );
    });

    it("reports a null gameId when Steam's game is not mapped", async () => {
        const { service, state } = fixture();
        state.mapped = [];

        const result = await service.getPresence("user-1");

        expect(result.playing).toEqual({
            source: "steam",
            name: "Counter-Strike 2",
            gameId: null,
        });
    });

    it("returns playing null when the user is not in a game", async () => {
        const { service, externalGames, state } = fixture();
        state.summary = {} as UserSummary;

        const result = await service.getPresence("user-1");

        expect(result).toEqual({ playing: null });
        expect(
            externalGames.getExternalGamesForSourceIds,
        ).not.toHaveBeenCalled();
    });

    it.each([{}, { gameID: 730 }])(
        "returns playing null when Steam hides the game details (%o)",
        async (summary) => {
            const { service, externalGames, state } = fixture();
            state.summary = summary as UserSummary;

            const result = await service.getPresence("user-1");

            expect(result).toEqual({ playing: null });
            expect(
                externalGames.getExternalGamesForSourceIds,
            ).not.toHaveBeenCalled();
        },
    );

    it("returns playing null without querying Steam for a non-supporter", async () => {
        const { service, connections, steam, preferences, state } = fixture();
        state.isSupporter = false;

        const result = await service.getPresence("user-1");

        expect(result).toEqual({ playing: null });
        expect(preferences.findOrDefaults).not.toHaveBeenCalled();
        expect(connections.findOneByUserIdAndType).not.toHaveBeenCalled();
        expect(steam.getUserSummary).not.toHaveBeenCalled();
    });

    it("returns playing null without querying Steam when showLiveProfile is false", async () => {
        const { service, connections, steam, state } = fixture();
        state.preferences = { ...state.preferences, showLiveProfile: false };

        const result = await service.getPresence("user-1");

        expect(result).toEqual({ playing: null });
        expect(connections.findOneByUserIdAndType).not.toHaveBeenCalled();
        expect(steam.getUserSummary).not.toHaveBeenCalled();
    });

    it("returns playing null without querying Steam when there is no Steam connection", async () => {
        const { service, steam, state } = fixture();
        state.connection = null;

        const result = await service.getPresence("user-1");

        expect(result).toEqual({ playing: null });
        expect(steam.getUserSummary).not.toHaveBeenCalled();
    });

    it("returns playing null and caches the result when Steam fails", async () => {
        const { service, steam, cacheManager } = fixture();
        steam.getUserSummary.mockRejectedValue(new Error("Steam unavailable"));

        const result = await service.getPresence("user-1");

        expect(result).toEqual({ playing: null });
        expect(cacheManager.set).toHaveBeenCalledWith(
            profilePresenceCacheKey("user-1"),
            { playing: null },
            60_000,
        );

        jest.clearAllMocks();
        await expect(service.getPresence("user-1")).resolves.toEqual({
            playing: null,
        });
        expect(steam.getUserSummary).not.toHaveBeenCalled();
    });

    it("calls Steam at most once per cached window", async () => {
        const { service, billing, steam } = fixture();

        const first = await service.getPresence("user-1");
        const second = await service.getPresence("user-1");

        expect(second).toEqual(first);
        expect(billing.isSupporter).toHaveBeenCalledTimes(1);
        expect(steam.getUserSummary).toHaveBeenCalledTimes(1);
    });

    it("shares one in-flight resolution between concurrent viewers", async () => {
        const { service, steam } = fixture();
        let release!: (summary: UserSummary) => void;
        steam.getUserSummary.mockReturnValue(
            new Promise<UserSummary>((resolve) => {
                release = resolve;
            }),
        );

        const first = service.getPresence("user-1");
        const second = service.getPresence("user-1");
        await new Promise((resolve) => setImmediate(resolve));
        release({
            gameID: 730,
            gameName: "Counter-Strike 2",
        } as UserSummary);

        await expect(Promise.all([first, second])).resolves.toEqual([
            {
                playing: {
                    source: "steam",
                    name: "Counter-Strike 2",
                    gameId: 42,
                },
            },
            {
                playing: {
                    source: "steam",
                    name: "Counter-Strike 2",
                    gameId: 42,
                },
            },
        ]);
        expect(steam.getUserSummary).toHaveBeenCalledTimes(1);
    });

    it("caches null results so repeated reads of a non-supporter stay cheap", async () => {
        const { service, billing, steam, state } = fixture();
        state.isSupporter = false;

        await expect(service.getPresence("user-1")).resolves.toEqual({
            playing: null,
        });

        jest.clearAllMocks();
        await expect(service.getPresence("user-1")).resolves.toEqual({
            playing: null,
        });
        expect(billing.isSupporter).not.toHaveBeenCalled();
        expect(steam.getUserSummary).not.toHaveBeenCalled();
    });

    it("serves the read when the cache fails", async () => {
        const { service, cacheManager } = fixture();
        cacheManager.get.mockRejectedValueOnce(new Error("cache down"));
        cacheManager.set.mockRejectedValueOnce(new Error("cache down"));

        await expect(service.getPresence("user-1")).resolves.toEqual({
            playing: {
                source: "steam",
                name: "Counter-Strike 2",
                gameId: 42,
            },
        });
    });

    // 5.2: the PATCH deletes this key, so the new preference applies immediately.
    it("returns playing null after showLiveProfile is disabled and the key is deleted", async () => {
        const { service, cacheManager, steam, state } = fixture();

        await expect(service.getPresence("user-1")).resolves.toEqual({
            playing: {
                source: "steam",
                name: "Counter-Strike 2",
                gameId: 42,
            },
        });
        expect(steam.getUserSummary).toHaveBeenCalledTimes(1);

        state.preferences = { ...state.preferences, showLiveProfile: false };
        await cacheManager.del(profilePresenceCacheKey("user-1"));

        await expect(service.getPresence("user-1")).resolves.toEqual({
            playing: null,
        });
        expect(steam.getUserSummary).toHaveBeenCalledTimes(1);
    });
});
