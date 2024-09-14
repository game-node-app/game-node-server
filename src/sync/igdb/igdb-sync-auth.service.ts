import { Injectable, Logger } from "@nestjs/common";
import { Cache } from "@nestjs/cache-manager";
import { days } from "@nestjs/throttler";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { lastValueFrom } from "rxjs";

interface TwitchAuthResponse {
    access_token: string;
    expires_in: number;
    token_type: string;
}

@Injectable()
export class IgdbSyncAuthService {
    private logger = new Logger(IgdbSyncAuthService.name);
    private ACCESS_TOKEN_EX_TIME = days(7);
    private readonly ACCESS_TOKEN_CACHE_KEY = "twitch-access-token";

    constructor(
        private readonly httpService: HttpService,
        private readonly cache: Cache,
        private readonly configService: ConfigService,
    ) {
        this.getAccessToken();
    }

    private getFromStore(): Promise<string | undefined> {
        return this.cache.get(this.ACCESS_TOKEN_CACHE_KEY);
    }

    private saveToStore(accessToken: string) {
        this.cache
            .set(
                this.ACCESS_TOKEN_CACHE_KEY,
                accessToken,
                this.ACCESS_TOKEN_EX_TIME,
            )
            .catch((err) => {
                this.logger.error(
                    `Error while storing accessToken in cache: ${err}`,
                );
            });
    }

    /**
     * Fetches a new access token from twitch's API.
     * @private
     */
    private async fetchAccessToken() {
        const TWITCH_CLIENT_ID =
            this.configService.get<string>("TWITCH_CLIENT_ID");
        const TWITCH_CLIENT_SECRET = this.configService.get<string>(
            "TWITCH_CLIENT_SECRET",
        );

        if (
            TWITCH_CLIENT_ID == undefined ||
            TWITCH_CLIENT_SECRET == undefined
        ) {
            throw new Error(
                `TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET environment variables are not defined.`,
            );
        }

        const response = await lastValueFrom(
            this.httpService.post<TwitchAuthResponse>(
                "https://id.twitch.tv/oauth2/token",
                {
                    client_id: TWITCH_CLIENT_ID,
                    client_secret: TWITCH_CLIENT_SECRET,
                    grant_type: "client_credentials",
                },
            ),
        );

        this.saveToStore(response.data.access_token);

        return response.data.access_token;
    }

    public async getAccessToken(): Promise<string> {
        const tokenInCache = await this.getFromStore();
        if (tokenInCache) {
            this.logger.log("Using access token stored in cache...");
            return tokenInCache;
        }

        this.logger.log("Fetching new access token...");
        return await this.fetchAccessToken();
    }
}
