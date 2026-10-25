import { PlayerLibrarySnapshot } from "../player-sync-attempt";
import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import SteamAPI, { UserSummary } from "steamapi";
import { hours, minutes } from "@nestjs/throttler";
import { ConnectionUserResolveDto } from "../../connection/dto/connection-user-resolve.dto";
import { Cacheable } from "../../utils/cacheable";
import { providerCall, ProviderSyncError } from "../provider-sync.error";
import axios from "axios";
import { cancellableProviderCall } from "../player-sync-attempt";
import { GameStatsResponse } from "./steam-sync.types";

@Injectable()
export class SteamSyncService {
    private logger = new Logger(SteamSyncService.name);
    private client: SteamAPI;

    constructor(private readonly configService: ConfigService) {
        const steamKey = this.configService.get("STEAM_API_KEY");
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        import("steamapi").then((p) => {
            if (!steamKey) {
                this.logger.warn(
                    `STEAM_API_KEY not provided. Services related to Steam Sync will not work.`,
                );
                return;
            }
            const client = new p.default(steamKey);
            client.get = (path, params = {}, base = client.baseAPI) =>
                cancellableProviderCall("Steam", async (signal) => {
                    const { data } = await axios.get(base + path, {
                        params: { ...params, key: steamKey },
                        headers: client.headers,
                        timeout: 30_000,
                        signal,
                    });
                    const count =
                        path === "/IPlayerService/GetOwnedGames/v1"
                            ? data?.response?.game_count
                            : path ===
                                "/IPlayerService/GetRecentlyPlayedGames/v1"
                              ? data?.response?.total_count
                              : undefined;
                    if (count === 0) {
                        const response = data.response;
                        if (
                            "error" in data ||
                            "error" in response ||
                            (response.games !== undefined &&
                                (!Array.isArray(response.games) ||
                                    response.games.length !== 0))
                        )
                            throw new ProviderSyncError(
                                "incomplete",
                                "Contradictory Steam empty-library response",
                            );
                        // The installed SDK maps games without checking explicit zero counts.
                        response.games = [];
                    }
                    return data;
                });
            this.client = client;
        });
    }

    /**
     * @param query - id, username, profile url, vanity url, steamID2, or steamID3
     */
    public async resolveUserInfo(
        query: string,
    ): Promise<ConnectionUserResolveDto> {
        let steamUserId: string;
        try {
            steamUserId = await this.client.resolve(query);
        } catch (err) {
            this.logger.error(err);
            throw new HttpException(
                "Invalid or non-existent profile URL",
                HttpStatus.BAD_REQUEST,
            );
        }

        const response = (await this.client.getUserSummary(
            steamUserId,
        )) as UserSummary;
        return {
            userId: response.steamID,
            username: response.nickname,
        };
    }

    public async getUserSummary(steamUserId: string): Promise<UserSummary> {
        return (await this.client.getUserSummary(steamUserId)) as UserSummary;
    }

    /**
     * Returns simple game info for user's owned games, with included playtime info.
     * @param steamUserId
     */
    @Cacheable(`${SteamSyncService.name}:complete-v1`, hours(1))
    public async getAllGames(steamUserId: string) {
        const games = await providerCall("Steam", () =>
            this.client.getUserOwnedGames(steamUserId, {
                includeAppInfo: false,
                includeFreeGames: true,
                language: "english",
            }),
        );
        if (
            !Array.isArray(games) ||
            games.some(
                (item) =>
                    !Number.isSafeInteger(item?.game?.id) || item.game.id <= 0,
            )
        )
            throw new ProviderSyncError(
                "incomplete",
                "Incomplete Steam owned-library response",
            );

        const sortedGames = games.toSorted((a, b) => {
            const timestampA = a.lastPlayedTimestamp ?? 0;
            const timestampB = b.lastPlayedTimestamp ?? 0;

            return timestampB - timestampA;
        });

        return sortedGames;
    }

    @Cacheable(`${SteamSyncService.name}:complete-v1`, hours(1))
    public async getRecentlyPlayedGames(steamUserId: string) {
        const recentGames = await providerCall("Steam", () =>
            this.client.getUserRecentGames(steamUserId),
        );
        if (
            !Array.isArray(recentGames) ||
            recentGames.some(
                (item) =>
                    !Number.isSafeInteger(item?.game?.id) || item.game.id <= 0,
            )
        )
            throw new ProviderSyncError(
                "incomplete",
                "Incomplete Steam recent-library response",
            );

        return recentGames.toSorted((a, b) => {
            const timestampA = a.lastPlayedTimestamp ?? 0;
            const timestampB = b.lastPlayedTimestamp ?? 0;

            return timestampB - timestampA;
        });
    }

    @PlayerLibrarySnapshot()
    public async getLibraryGames(steamUserId: string) {
        const [owned, recent] = await Promise.all([
            this.getAllGames(steamUserId),
            this.getRecentlyPlayedGames(steamUserId),
        ]);
        const games = new Map(owned.map((item) => [item.game.id, item]));
        for (const item of recent) {
            games.delete(item.game.id);
            games.set(item.game.id, item);
        }
        return [...games.values()];
    }

    @PlayerLibrarySnapshot()
    @Cacheable(`${SteamSyncService.name}:complete-v1`, hours(24))
    public async getAvailableAchievements(appId: number) {
        const response: GameStatsResponse = await providerCall("Steam", () =>
            this.client.getGameSchema(appId, "english"),
        );

        if (response == null || typeof response !== "object")
            throw new ProviderSyncError(
                "incomplete",
                "Incomplete Steam schema response",
            );
        if (response.availableGameStats == null)
            throw new ProviderSyncError(
                "unsupported",
                "Steam title has no achievement schema",
            );
        if (!Array.isArray(response.availableGameStats.achievements))
            throw new ProviderSyncError(
                "incomplete",
                "Incomplete Steam achievement schema",
            );
        return response.availableGameStats.achievements;
    }

    @Cacheable(`${SteamSyncService.name}:complete-v1`, hours(24))
    public async getAchievementsPercentage(appId: number) {
        return await this.client.getGameAchievementPercentages(appId);
    }

    @Cacheable(`${SteamSyncService.name}:complete-v1`, minutes(15))
    public async getUserAchievements(steamUserId: string, appId: number) {
        // A schema establishes unsupported titles without guessing from account errors.
        await this.getAvailableAchievements(appId);
        const response = await providerCall("Steam", () =>
            this.client.getUserAchievements(steamUserId, appId),
        );
        if (!Array.isArray(response?.achievements))
            throw new ProviderSyncError(
                "incomplete",
                "Incomplete Steam obtained-achievement response",
            );
        return response;
    }

    @Cacheable(`${SteamSyncService.name}:complete-v1`, hours(24))
    public async getUserBadges(steamUserId: string) {
        return await this.client.getUserBadges(steamUserId);
    }
}
