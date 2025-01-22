import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cache, CACHE_MANAGER } from "@nestjs/cache-manager";
import {
    AuthTokensResponse,
    exchangeCodeForAccessToken,
    exchangeNpssoForCode,
    exchangeRefreshTokenForAuthTokens,
} from "psn-api";
import { PSNTokenInfo } from "./psn-sync-auth.types";

@Injectable()
export class PsnSyncAuthService {
    private readonly logger = new Logger(PsnSyncAuthService.name);
    private readonly NPSSO_KEY: string | undefined;
    private readonly ACCESS_TOKEN_STORE_KEY = "psn-auth-access-token";

    constructor(
        private readonly configService: ConfigService,
        @Inject(CACHE_MANAGER)
        private readonly cacheManager: Cache,
    ) {
        this.NPSSO_KEY = this.configService.get("PSN_NPSSO_KEY");
        if (!this.NPSSO_KEY) {
            this.logger.warn(
                "PSN NPSSO key not provied! Services related to PSN.",
            );
        }
    }

    private setToStore(authResponse: AuthTokensResponse) {
        const tokenInfo: PSNTokenInfo = {
            accessToken: authResponse.accessToken,
            refreshToken: authResponse.refreshToken,
            expiresAt: new Date(
                Date.now() + authResponse.expiresIn * 1000,
            ).toISOString(),
            refreshTokenExpiresAt: new Date(
                Date.now() + authResponse.refreshTokenExpiresIn * 1000,
            ).toISOString(),
        };

        const refreshTokenExpiresInMs =
            authResponse.refreshTokenExpiresIn * 1000;

        this.cacheManager
            .set(
                this.ACCESS_TOKEN_STORE_KEY,
                tokenInfo,
                refreshTokenExpiresInMs,
            )
            .then(() => {
                const validUntil = new Date(
                    Date.now() + authResponse.refreshTokenExpiresIn * 1000,
                );
                this.logger.log(
                    `Stored new PSN access token at ${new Date().toISOString()} valid until ${validUntil.toISOString()}`,
                );
            })
            .catch((err) => {
                this.logger.error(err);
            });

        return tokenInfo;
    }

    /**
     * Both 'expiresIn' and 'refreshTokenExpiresIn' are stored in seconds. <br>
     * <strong>Make sure to convert to ms before transforming in a Javascript Date object</strong>.
     * @private
     */
    private async getFromStore(): Promise<PSNTokenInfo | undefined> {
        return await this.cacheManager.get<PSNTokenInfo>(
            this.ACCESS_TOKEN_STORE_KEY,
        );
    }

    /**
     * Should only be called when the current accessToken + expiresIn
     * combination is not valid anymore. <br>
     * <strong>Also persists new token info in the cache store.</strong>
     * @param refreshToken - if provided, will be used to refresh access token
     * @private
     */
    private async refreshAccessToken(refreshToken?: string) {
        if (refreshToken) {
            const refreshAuthResponse =
                await exchangeRefreshTokenForAuthTokens(refreshToken);
            return this.setToStore(refreshAuthResponse);
        }

        const accessCode = await exchangeNpssoForCode(this.NPSSO_KEY!);

        const authResponse = await exchangeCodeForAccessToken(accessCode);

        return this.setToStore(authResponse);
    }

    public async getValidAccessToken(): Promise<PSNTokenInfo> {
        if (!this.NPSSO_KEY) {
            throw new Error("PSN_NPSSO_KEY not provided!");
        }
        /**
         * Nullable if first request OR refreshToken is expired.
         */
        const tokenInStore = await this.getFromStore();

        /*
         * Ideally, we want to avoid running this section because it means that our fixed
         * NPSSO code is being used, and since it's static we can't be sure it's still valid.
         */
        if (tokenInStore == undefined) {
            return await this.refreshAccessToken();
        }

        const now = new Date();
        const tokenExpireDate = new Date(tokenInStore.expiresAt);

        /**
         * We can assume the 'refreshToken' is not expired because tokenInStore is not nullable.
         */
        const isTokenExpired = tokenExpireDate.getTime() < now.getTime();

        if (isTokenExpired) {
            return await this.refreshAccessToken(tokenInStore.refreshToken);
        }

        return tokenInStore;
    }
}
