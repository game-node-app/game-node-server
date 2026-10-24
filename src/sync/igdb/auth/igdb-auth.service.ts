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

    private refreshInFlight?: Promise<string>;

    private refreshToken(invalidate: boolean): Promise<string> {
        if (this.refreshInFlight) return this.refreshInFlight;
        this.refreshInFlight = (async () => {
            if (invalidate) await this.cacheManager.del(this.CACHE_KEY);
            const info = await this.getFromSource();
            if (
                !info ||
                typeof info.access_token !== "string" ||
                !info.access_token ||
                !Number.isFinite(info.expires_in) ||
                info.expires_in <= 0
            ) {
                throw new Error(
                    "IGDB authentication returned invalid credentials",
                );
            }
            const expiresInMs = info.expires_in * 1000;
            await this.cacheManager.set(
                this.CACHE_KEY,
                info.access_token,
                expiresInMs,
            );
            this.logger.log(
                `Persisted IGDB token expiring at ${dayjs().add(expiresInMs, "milliseconds").toISOString()}`,
            );
            return info.access_token;
        })().finally(() => {
            this.refreshInFlight = undefined;
        });
        return this.refreshInFlight;
    }

    private async getFromSource() {
        const request = this.httpClient.post<IGDBAuthInfo>(
            this.TWITCH_AUTH_API,
            undefined,
            {
                timeout: 30000,
                maxContentLength: 1048576,
                signal: AbortSignal.timeout(30000),
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

    public async getAuthToken(forceRefresh = false) {
        if (this.refreshInFlight) return this.refreshInFlight;
        if (forceRefresh) return this.refreshToken(true);
        const tokenOnStore = await this.getFromStore();
        return tokenOnStore || this.refreshToken(false);
    }

    public async getAuthHeaders(forceRefresh = false) {
        const token = await this.getAuthToken(forceRefresh);
        return {
            "Client-ID":
                this.configService.getOrThrow<string>("TWITCH_CLIENT_ID"),
            Authorization: `Bearer ${token}`,
        };
    }
}
