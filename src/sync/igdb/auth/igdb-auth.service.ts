import { Injectable, Logger } from "@nestjs/common";
import { Cache } from "@nestjs/cache-manager";
import { HttpService } from "@nestjs/axios";
import { IGDBAuthInfo } from "../igdb-sync.constants";
import { ConfigService } from "@nestjs/config";
import { lastValueFrom } from "rxjs";
import dayjs from "dayjs";

@Injectable()
export class IgdbAuthService {
    private readonly logger = new Logger(IgdbAuthService.name);
    private readonly CACHE_KEY = "igdb-auth-token";
    private readonly TWITCH_AUTH_API = "https://id.twitch.tv/oauth2/token";

    constructor(
        private readonly configService: ConfigService,
        private readonly cacheManager: Cache,
        private readonly httpClient: HttpService,
    ) {}

    private async getFromStore() {
        return await this.cacheManager.get<string>(this.CACHE_KEY);
    }

    private setToStore(authInfo: IGDBAuthInfo) {
        const expiresInMs = authInfo.expires_in * 1000;

        this.cacheManager
            .set(this.CACHE_KEY, authInfo.access_token, expiresInMs)
            .then(() => {
                const expiresAt = dayjs().add(expiresInMs, "milliseconds");
                this.logger.log(
                    `Persisted new IGDB token at store that expires at ${expiresAt.toISOString()}`,
                );
            })
            .catch((err) => {
                this.logger.error(err);
            });
    }

    private async getFromSource() {
        const request = this.httpClient.post<IGDBAuthInfo>(
            this.TWITCH_AUTH_API,
            undefined,
            {
                params: {
                    client_id:
                        this.configService.getOrThrow("TWITCH_CLIENT_ID"),
                    client_secret: this.configService.getOrThrow(
                        "TWITCH_CLIENT_SECRET",
                    ),
                    grant_type: "client_credentials",
                },
            },
        );

        const response = await lastValueFrom(request);

        return response.data;
    }

    public async getAuthToken() {
        const tokenOnStore = await this.getFromStore();
        if (tokenOnStore) {
            return tokenOnStore;
        }

        const tokenFromSource = await this.getFromSource();

        if (tokenFromSource) {
            this.setToStore(tokenFromSource);
        }

        return tokenFromSource.access_token;
    }

    public async getAuthHeaders() {
        const token = await this.getAuthToken();
        return {
            "Client-ID":
                this.configService.getOrThrow<string>("TWITCH_CLIENT_ID"),
            Authorization: `Bearer ${token}`,
        };
    }
}
