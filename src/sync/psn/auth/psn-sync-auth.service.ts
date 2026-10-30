import { uncancellableProviderCall } from "../../player-sync-attempt";
import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cache, CACHE_MANAGER } from "@nestjs/cache-manager";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
    AuthTokensResponse,
    exchangeCodeForAccessToken,
    exchangeNpssoForCode,
    exchangeRefreshTokenForAuthTokens,
} from "psn-api";
import { PSNTokenInfo } from "./psn-sync-auth.types";
import { PsnSystemCredential } from "./psn-system-credential.entity";
import { ConnectionCredentialCryptoService } from "../../../connection/connection-credential-crypto.service";

/**
 * Stable, searchable marker for log aggregators.
 */
export const PSN_SYSTEM_AUTH_FAILED = "PSN_SYSTEM_AUTH_FAILED";

const SYSTEM_CREDENTIAL_ID = 1;

@Injectable()
export class PsnSyncAuthService {
    private readonly logger = new Logger(PsnSyncAuthService.name);
    private readonly ENV_NPSSO: string | undefined;
    private readonly ACCESS_TOKEN_STORE_KEY = "psn-auth-access-token";

    constructor(
        private readonly configService: ConfigService,
        @Inject(CACHE_MANAGER)
        private readonly cacheManager: Cache,
        @InjectRepository(PsnSystemCredential)
        private readonly credentialRepository: Repository<PsnSystemCredential>,
        private readonly cryptoService: ConnectionCredentialCryptoService,
    ) {
        this.ENV_NPSSO = this.configService.get("PSN_NPSSO_KEY");
        if (!this.ENV_NPSSO) {
            this.logger.warn(
                "PSN NPSSO key not provied! Services related to PSN will not work until one is set via the admin endpoint.",
            );
        }
    }

    /**
     * Runtime NPSSO (database, encrypted) takes precedence over PSN_NPSSO_KEY.
     */
    private async resolveNpsso(): Promise<string | undefined> {
        const row = await this.credentialRepository.findOneBy({
            id: SYSTEM_CREDENTIAL_ID,
        });
        return row
            ? this.cryptoService.decrypt(row.npssoEncrypted)
            : this.ENV_NPSSO;
    }

    public async hasNpsso(): Promise<boolean> {
        const count = await this.credentialRepository.countBy({
            id: SYSTEM_CREDENTIAL_ID,
        });
        return count > 0 || !!this.ENV_NPSSO;
    }

    /**
     * The Sony endpoint answers a rejected refresh with undefined fields instead of throwing.
     */
    private assertAccessToken(authResponse: AuthTokensResponse) {
        if (!authResponse?.accessToken) {
            throw new Error("PSN returned no access token");
        }
    }

    private async setToStore(authResponse: AuthTokensResponse) {
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

        await this.cacheManager.set(
            this.ACCESS_TOKEN_STORE_KEY,
            tokenInfo,
            authResponse.refreshTokenExpiresIn * 1000,
        );
        this.logger.log(
            `Stored new PSN access token at ${new Date().toISOString()} valid until ${tokenInfo.refreshTokenExpiresAt}`,
        );

        return tokenInfo;
    }

    /**
     * Both 'expiresIn' and 'refreshTokenExpiresIn' are stored in seconds. <br>
     * <strong>Make sure to convert to ms before transforming in a Javascript Date object</strong>.
     * @private
     */
    private async getFromStore(): Promise<PSNTokenInfo | null> {
        return await this.cacheManager.get<PSNTokenInfo>(
            this.ACCESS_TOKEN_STORE_KEY,
        );
    }

    private async exchangeNpsso(npsso: string) {
        const accessCode = await uncancellableProviderCall("PSN", () =>
            exchangeNpssoForCode(npsso),
        );
        const authResponse = await uncancellableProviderCall("PSN", () =>
            exchangeCodeForAccessToken(accessCode),
        );
        this.assertAccessToken(authResponse);
        return authResponse;
    }

    private async refreshWithRefreshToken(refreshToken: string) {
        const authResponse = await uncancellableProviderCall("PSN", () =>
            exchangeRefreshTokenForAuthTokens(refreshToken),
        );
        this.assertAccessToken(authResponse);
        return await this.setToStore(authResponse);
    }

    /**
     * Only place that reads the NPSSO. <strong>Also persists new token info in the cache store.</strong>
     * @param refreshError - set when this runs as fallback for a rejected refresh
     * @private
     */
    private async authenticateWithNpsso(refreshError?: unknown) {
        try {
            const npsso = await this.resolveNpsso();
            if (!npsso) {
                throw new Error("no NPSSO configured");
            }
            return await this.setToStore(await this.exchangeNpsso(npsso));
        } catch (cause) {
            const reason = (e: unknown) =>
                e instanceof Error ? e.message : String(e);
            throw new Error(
                `${PSN_SYSTEM_AUTH_FAILED}: ${
                    refreshError
                        ? `refresh failed (${reason(refreshError)}); `
                        : ""
                }NPSSO exchange failed (${reason(cause)})`,
                { cause },
            );
        }
    }

    /**
     * Validates the NPSSO with Sony before storing it, so a bad value never replaces the current one.
     * @returns the new refresh token expiration date (ISO)
     */
    public async rotateNpsso(npsso: string): Promise<string> {
        let authResponse: AuthTokensResponse;
        try {
            authResponse = await this.exchangeNpsso(npsso);
        } catch {
            throw new BadRequestException("PSN rejected the provided NPSSO");
        }

        await this.credentialRepository.upsert(
            {
                id: SYSTEM_CREDENTIAL_ID,
                npssoEncrypted: this.cryptoService.encrypt(npsso),
            },
            ["id"],
        );
        const tokenInfo = await this.setToStore(authResponse);
        return tokenInfo.refreshTokenExpiresAt;
    }

    public async getValidAccessToken(): Promise<PSNTokenInfo> {
        /**
         * Nullable if first request OR refreshToken is expired.
         */
        const tokenInStore = await this.getFromStore();

        /*
         * Ideally, we want to avoid running this section because it means that our fixed
         * NPSSO code is being used, and since it's static we can't be sure it's still valid.
         */
        if (tokenInStore == undefined) {
            return await this.authenticateWithNpsso();
        }

        const now = new Date();
        const tokenExpireDate = new Date(tokenInStore.expiresAt);

        /**
         * We can assume the 'refreshToken' is not expired because tokenInStore is not nullable.
         */
        const isTokenExpired = tokenExpireDate.getTime() < now.getTime();

        if (isTokenExpired) {
            try {
                return await this.refreshWithRefreshToken(
                    tokenInStore.refreshToken,
                );
            } catch (refreshError) {
                // A dead token must not stay cached until its TTL.
                await this.cacheManager.del(this.ACCESS_TOKEN_STORE_KEY);
                return await this.authenticateWithNpsso(refreshError);
            }
        }

        return tokenInStore;
    }
}
