import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
// @ts-expect-error ESModule import in CommonJS file, breaks if used
// without 'import()'
import SteamAPI, { UserSummary } from "steamapi";
import { SteamUserIdResolveResponseDto } from "./dto/steam-user-id-resolve-response.dto";

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

    public async getAllGames(steamUserId: string) {
        return this.client.getUserOwnedGames(steamUserId, {
            includeAppInfo: false,
            includeFreeGames: true,
            language: "english",
        });
    }
}
