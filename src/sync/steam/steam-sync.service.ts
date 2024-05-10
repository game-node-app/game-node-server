import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import SteamAPI, {
    UserSummary,
    // @ts-expect-error ESModule import in CommonJS file, breaks if used
    // without 'import()'
} from "steamapi";
import { SteamUserIdResolveResponseDto } from "./dto/steam-user-id-resolve-response.dto";
import { Cache } from "@nestjs/cache-manager";
import { minutes } from "@nestjs/throttler";

@Injectable()
export class SteamSyncService {
    private logger = new Logger(SteamSyncService.name);
    private client: SteamAPI;

    constructor(
        private readonly configService: ConfigService,
        private readonly cacheManager: Cache,
    ) {
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
        });
    }

    /**
     * @param query - id, username, profile url, vanity url, steamID2, or steamID3
     */
    public async resolveUserInfo(
        query: string,
    ): Promise<SteamUserIdResolveResponseDto> {
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

    public async getAllGames(
        steamUserId: string,
    ): Promise<ReturnType<typeof this.client.getUserOwnedGames>> {
        const possibleCachedGames = await this.cacheManager.get<any>(
            `steam-sync-games-${steamUserId}`,
        );
        if (possibleCachedGames) {
            return possibleCachedGames;
        }
        const games = await this.client.getUserOwnedGames(steamUserId, {
            includeAppInfo: false,
            includeFreeGames: true,
            language: "english",
        });

        this.cacheManager
            .set(`steam-sync-games-${steamUserId}`, games, minutes(10))
            .then()
            .catch();

        return games;
    }
}
