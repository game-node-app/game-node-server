import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import SteamAPI, { UserSummary } from "steamapi";
import { hours } from "@nestjs/throttler";
import { ConnectionUserResolveDto } from "../../connections/dto/connection-user-resolve.dto";
import { Cacheable } from "../../utils/cacheable";

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
            this.client = new p.default(steamKey);
            // (async () => {
            //     const test = await this.getAllGames("76561198136665859");
            //
            //     console.log(test);
            // })();
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

    /**
     * Returns simple game info for user's owned games, with included playtime info.
     * @param steamUserId
     */
    @Cacheable(SteamSyncService.name, hours(1))
    public async getAllGames(
        steamUserId: string,
    ): Promise<ReturnType<typeof this.client.getUserOwnedGames>> {
        const games = await this.client.getUserOwnedGames(steamUserId, {
            includeAppInfo: false,
            includeFreeGames: true,
            language: "english",
        });

        const sortedGames = games.toSorted((a, b) => {
            const timestampA = a.lastPlayedTimestamp ?? 0;
            const timestampB = b.lastPlayedTimestamp ?? 0;

            return timestampB - timestampA;
        });

        return sortedGames;
    }
}
