import * as process from "process";
import { lastValueFrom, map } from "rxjs";
import { Interval } from "@nestjs/schedule";
import igdb from "igdb-api-node";
import { Inject, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";

type TokenResponse = {
    access_token: string;
    // Converted to 'milliseconds since epoch' when stored.
    expires_in: number;
    token_type: string;
};

export const TOKEN_REFRESH_INTERVAL_SECONDS = 604800;

export class IgdbAuthService {
    private logger: Logger;
    private cacheKey = "TWITCH_ACCESS_TOKEN";

    constructor(
        private readonly httpService: HttpService,
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
    ) {
        this.logger = new Logger(IgdbAuthService.name);
    }

    private async getFromStore(): Promise<TokenResponse | undefined> {
        return this.cacheManager.get<TokenResponse>(this.cacheKey);
    }

    private async setToStore(token: TokenResponse): Promise<void> {
        await this.cacheManager.set(
            this.cacheKey,
            token,
            TOKEN_REFRESH_INTERVAL_SECONDS * 1000,
        );
    }

    private async fetchToken(): Promise<TokenResponse> {
        const clientId = process.env.TWITCH_CLIENT_ID;
        const clientSecret = process.env.TWITCH_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
            throw new Error(
                "TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET is not defined. Aborting.",
            );
        }
        const response = await this.httpService.post<TokenResponse>(
            "https://id.twitch.tv/oauth2/token",
            null,
            {
                params: {
                    client_id: clientId,
                    client_secret: clientSecret,
                    grant_type: "client_credentials",
                },
            },
        );

        return lastValueFrom(
            response.pipe(
                map((res) => {
                    const { data } = res;
                    if (typeof data.expires_in === "number") {
                        data.expires_in = Date.now() + data.expires_in * 1000;
                    }
                    return data;
                }),
            ),
        );
    }

    async refreshToken(): Promise<string> {
        const tokenOnStore = await this.getFromStore();
        // (tokenRefreshIntervalSeconds * 1000) days in ms from now.
        const considerExpiredAt =
            Date.now() + TOKEN_REFRESH_INTERVAL_SECONDS * 1000;
        if (
            tokenOnStore == undefined ||
            tokenOnStore.expires_in < considerExpiredAt
        ) {
            this.logger.log(
                "Token is expired or not found. Fetching new token.",
            );
            try {
                const token = await this.fetchToken();
                this.logger.log(
                    `Token fetched sucessfully at ${new Date().toISOString()}`,
                );
                await this.setToStore(token);
                return token.access_token;
            } catch (e) {
                this.logger.error(e.message, e.stack);
                if (
                    tokenOnStore != undefined &&
                    tokenOnStore.expires_in > Date.now()
                ) {
                    this.logger.log("Using store token as it has not expired.");
                    return tokenOnStore.access_token;
                } else {
                    this.logger.error(
                        "Failed to fetch token and store token is expired or nonexistent.",
                    );
                    this.logger.error(
                        "IGDB services will be unavailable. Aborting.",
                    );
                    throw new Error("Failed to fetch token. Aborting.");
                }
            }
        } else {
            this.logger.log("Found a valid IGDB token on store.");
            return tokenOnStore.access_token;
        }
    }
}
