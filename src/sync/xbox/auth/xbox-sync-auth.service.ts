import { uncancellableProviderCall } from "../../player-sync-attempt";
import { providerFailure, ProviderSyncError } from "../../provider-sync.error";
import { forwardRef, Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cache, CACHE_MANAGER } from "@nestjs/cache-manager";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { randomUUID } from "node:crypto";
import { PLAYER_PROVIDER_BUDGET_QUEUE } from "../../player-provider-budget.service";
import { authenticate, Email } from "@xboxreplay/xboxlive-auth";
import axios from "axios";
import { UserConnection } from "../../../connection/entity/user-connection.entity";
import { ConnectionCredentialService } from "../../../connection/connection-credential.service";
import {
    EConnectionAuthStatus,
    EConnectionType,
} from "../../../connection/connections.constants";

@Injectable()
export class XboxSyncAuthService {
    private static readonly LOCK_MS = 60_000;
    private static readonly SAFETY_BUFFER_MS = 5 * 60 * 1000;

    constructor(
        private readonly configService: ConfigService,
        @Inject(CACHE_MANAGER)
        private readonly cacheManager: Cache,
        @InjectRepository(UserConnection)
        private readonly connectionRepository: Repository<UserConnection>,
        @Inject(forwardRef(() => ConnectionCredentialService))
        private readonly credentialService: ConnectionCredentialService,
        @InjectQueue(PLAYER_PROVIDER_BUDGET_QUEUE)
        private readonly queue: Queue,
    ) {}

    private async acquireLock(
        lockKey: string,
        token: string,
        maxWaitMs = 10_000,
    ) {
        const redis = await this.queue.client;
        const deadline = Date.now() + maxWaitMs;
        do {
            if (
                await redis.set(
                    lockKey,
                    token,
                    "PX",
                    XboxSyncAuthService.LOCK_MS,
                    "NX",
                )
            )
                return true;
            await new Promise((resolve) => setTimeout(resolve, 25));
        } while (Date.now() < deadline);
        return false;
    }

    private async renewLock(lockKey: string, token: string) {
        const redis = await this.queue.client;
        return redis.eval(
            "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) end; return 0",
            1,
            lockKey,
            token,
            XboxSyncAuthService.LOCK_MS,
        );
    }

    private async releaseLock(lockKey: string, token: string) {
        const redis = await this.queue.client;
        await redis.eval(
            "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end; return 0",
            1,
            lockKey,
            token,
        );
    }

    public async getUserAuthCredentials(playerXUID: string): Promise<{
        XSTSToken: string;
        userHash: string;
    }> {
        const connection = await this.connectionRepository.findOne({
            where: {
                type: EConnectionType.XBOX,
                sourceUserId: playerXUID,
            },
        });

        if (!connection) {
            throw new ProviderSyncError(
                "unsupported",
                `No Xbox connection found for player ${playerXUID}`,
            );
        }

        if (connection.authStatus === EConnectionAuthStatus.REAUTH_REQUIRED) {
            throw new ProviderSyncError(
                "reauth_required",
                "Xbox connection requires re-authentication",
            );
        }

        const credentials = await this.credentialService.getCredentials(
            connection.id,
        );

        if (!credentials?.providerMetadata) {
            throw new ProviderSyncError(
                "failed",
                `Missing Xbox credentials for connection ${connection.id}`,
            );
        }

        const metadata = credentials.providerMetadata;
        const xstsToken = metadata.xstsToken;
        const userHash = metadata.userHash;
        const xstsExpiresAt = metadata.xstsExpiresAt
            ? new Date(metadata.xstsExpiresAt).getTime()
            : 0;
        const SAFETY_BUFFER_MS = XboxSyncAuthService.SAFETY_BUFFER_MS;

        if (
            xstsToken &&
            userHash &&
            xstsExpiresAt - Date.now() > SAFETY_BUFFER_MS
        ) {
            return {
                XSTSToken: xstsToken,
                userHash,
            };
        }

        // Token expired or near expiration: acquire lock and refresh
        const lockKey = `xbox-token-refresh-lock:${connection.id}`;
        const token = randomUUID();
        const acquired = await this.acquireLock(lockKey, token);
        if (!acquired) {
            throw new ProviderSyncError(
                "unavailable",
                `Timeout acquiring Xbox token refresh lock for connection ${connection.id}`,
            );
        }

        let lockLost = false;
        const renewal = setInterval(() => {
            this.renewLock(lockKey, token)
                .then((result) => {
                    if (result !== 1) lockLost = true;
                })
                .catch(() => {
                    lockLost = true;
                });
        }, XboxSyncAuthService.LOCK_MS / 3);
        const assertLock = async () => {
            const redis = await this.queue.client;
            if (lockLost || (await redis.get(lockKey)) !== token)
                throw new ProviderSyncError(
                    "unavailable",
                    "Xbox token refresh lock ownership lost",
                );
        };
        try {
            // Re-read credentials under lock
            const rechecked = await this.credentialService.getCredentials(
                connection.id,
            );
            if (rechecked?.providerMetadata) {
                const recheckMeta = rechecked.providerMetadata;
                const recheckExpires = recheckMeta.xstsExpiresAt
                    ? new Date(recheckMeta.xstsExpiresAt).getTime()
                    : 0;
                if (
                    recheckMeta.xstsToken &&
                    recheckMeta.userHash &&
                    recheckExpires - Date.now() > SAFETY_BUFFER_MS
                ) {
                    return {
                        XSTSToken: recheckMeta.xstsToken,
                        userHash: recheckMeta.userHash,
                    };
                }
            }

            const refreshToken =
                rechecked?.refreshToken || credentials.refreshToken;
            if (!refreshToken) {
                await assertLock();
                connection.authStatus = EConnectionAuthStatus.REAUTH_REQUIRED;
                await this.connectionRepository.save(connection);
                throw new ProviderSyncError(
                    "reauth_required",
                    "No refresh token available for Xbox connection",
                );
            }

            return await this.refreshTokens(
                connection,
                refreshToken,
                assertLock,
            );
        } finally {
            clearInterval(renewal);
            await this.releaseLock(lockKey, token);
        }
    }

    private async refreshTokens(
        connection: UserConnection,
        refreshToken: string,
        assertLock: () => Promise<void>,
    ): Promise<{ XSTSToken: string; userHash: string }> {
        const clientId =
            this.configService.get<string>("XBOX_OAUTH_CLIENT_ID") || "";
        const clientSecret =
            this.configService.get<string>("XBOX_OAUTH_CLIENT_SECRET") || "";

        let msTokens: {
            access_token: string;
            refresh_token?: string;
            expires_in?: number;
        };

        try {
            const tokenParams = new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                grant_type: "refresh_token",
                refresh_token: refreshToken,
                scope: "Xboxlive.signin Xboxlive.offline_access",
            });

            const tokenRes = await uncancellableProviderCall("Xbox", () =>
                axios.post(
                    "https://login.live.com/oauth20_token.srf",
                    tokenParams.toString(),
                    {
                        headers: {
                            "Content-Type": "application/x-www-form-urlencoded",
                        },
                        timeout: 15_000,
                    },
                ),
            );
            msTokens = tokenRes.data;
        } catch (err: any) {
            const cause = err instanceof ProviderSyncError ? err.cause : err;
            const response = (cause as any)?.response || err.response;
            const errData = response?.data || (cause as any)?.data;
            const status = response?.status || (cause as any)?.status;
            const errCode = errData?.error;

            if (
                errCode === "invalid_grant" ||
                status === 400 ||
                status === 401
            ) {
                await assertLock();
                connection.authStatus = EConnectionAuthStatus.REAUTH_REQUIRED;
                await this.connectionRepository!.save(connection);
                throw new ProviderSyncError(
                    "reauth_required",
                    `Xbox OAuth refresh token revoked or expired: ${
                        errData?.error_description ||
                        (cause as any)?.message ||
                        err.message
                    }`,
                );
            }

            throw providerFailure("Xbox", err);
        }

        let xblToken: string;
        try {
            const xblRes = await uncancellableProviderCall("Xbox", () =>
                axios.post(
                    "https://user.auth.xboxlive.com/user/authenticate",
                    {
                        RelyingParty: "http://auth.xboxlive.com",
                        TokenType: "JWT",
                        Properties: {
                            AuthMethod: "RPS",
                            SiteName: "user.auth.xboxlive.com",
                            RpsTicket: `d=${msTokens.access_token}`,
                        },
                    },
                    {
                        headers: {
                            "Content-Type": "application/json",
                            Accept: "application/json",
                        },
                        timeout: 15_000,
                    },
                ),
            );
            xblToken = xblRes.data.Token;
        } catch (err: any) {
            throw providerFailure("Xbox", err);
        }

        let xstsData: any;
        try {
            const xstsRes = await uncancellableProviderCall("Xbox", () =>
                axios.post(
                    "https://xsts.auth.xboxlive.com/xsts/authorize",
                    {
                        RelyingParty: "http://xboxlive.com",
                        TokenType: "JWT",
                        Properties: {
                            SandboxId: "RETAIL",
                            UserTokens: [xblToken],
                        },
                    },
                    {
                        headers: {
                            "Content-Type": "application/json",
                            Accept: "application/json",
                        },
                        timeout: 15_000,
                    },
                ),
            );
            xstsData = xstsRes.data;
        } catch (err: any) {
            const cause = err instanceof ProviderSyncError ? err.cause : err;
            const response = (cause as any)?.response || err.response;
            const xerr = response?.data?.XErr;
            if (typeof xerr === "number") {
                await assertLock();
                connection.authStatus = EConnectionAuthStatus.REAUTH_REQUIRED;
                await this.connectionRepository!.save(connection);
                throw new ProviderSyncError(
                    "reauth_required",
                    `Xbox XSTS authorization failed with XErr: ${xerr}`,
                );
            }
            throw providerFailure("Xbox", err);
        }

        const displayClaim = xstsData?.DisplayClaims?.xui?.[0];
        const userHash = displayClaim?.uhs;
        const xstsToken = xstsData?.Token;
        const xstsExpiresAt = xstsData?.NotAfter;

        if (!xstsToken || !userHash) {
            throw new ProviderSyncError(
                "failed",
                "Failed to extract XSTS token or userHash during refresh",
            );
        }

        const expiresInSec = msTokens.expires_in || 3600;
        const expiresAt = new Date(Date.now() + expiresInSec * 1000);

        await assertLock();
        await this.credentialService.saveCredentials(connection.id, {
            accessToken: msTokens.access_token,
            refreshToken: msTokens.refresh_token ?? refreshToken,
            expiresAt,
            refreshTokenExpiresAt: null,
            providerMetadata: {
                xstsToken,
                userHash,
                xstsExpiresAt,
            },
        });

        return {
            XSTSToken: xstsToken,
            userHash,
        };
    }

    public async getCatalogAuthCredentials(): Promise<{
        XSTSToken: string;
        userHash: string;
    }> {
        const catalogKey = "xbox-catalog-auth-cred";
        const cached = await this.cacheManager.get<{
            XSTSToken: string;
            userHash: string;
            expiresAt: number;
        }>(catalogKey);
        if (
            cached?.XSTSToken &&
            cached.userHash &&
            cached.expiresAt - Date.now() > XboxSyncAuthService.SAFETY_BUFFER_MS
        ) {
            return { XSTSToken: cached.XSTSToken, userHash: cached.userHash };
        }

        const systemUser = this.configService.get<Email>("XBOX_API_USER");
        const systemPassword = this.configService.get<string>("XBOX_API_PASS");
        let systemError: unknown;
        if (systemUser && systemPassword) {
            try {
                const auth = await uncancellableProviderCall(
                    "Xbox:catalog",
                    () => authenticate(systemUser, systemPassword),
                );
                const expiresAt = new Date(auth.expires_on).getTime();
                const ttl =
                    expiresAt -
                    Date.now() -
                    XboxSyncAuthService.SAFETY_BUFFER_MS;
                if (!Number.isFinite(ttl) || ttl <= 0)
                    throw new ProviderSyncError(
                        "unavailable",
                        "Xbox catalog token is expired or near expiration",
                    );
                const credentials = {
                    XSTSToken: auth.xsts_token,
                    userHash: auth.user_hash,
                };
                await this.cacheManager.set(
                    catalogKey,
                    { ...credentials, expiresAt },
                    ttl,
                );
                return credentials;
            } catch (error) {
                systemError = error;
            }
        }

        const connection = await this.connectionRepository.findOne({
            where: {
                type: EConnectionType.XBOX,
                authStatus: EConnectionAuthStatus.CONNECTED,
            },
        });
        if (connection) {
            const credentials = await this.getUserAuthCredentials(
                connection.sourceUserId,
            );
            const stored = await this.credentialService.getCredentials(
                connection.id,
            );
            const expiresAt = new Date(
                stored?.providerMetadata?.xstsExpiresAt ?? 0,
            ).getTime();
            const ttl =
                expiresAt - Date.now() - XboxSyncAuthService.SAFETY_BUFFER_MS;
            if (
                Number.isFinite(ttl) &&
                ttl > 0 &&
                stored?.providerMetadata?.xstsToken === credentials.XSTSToken
            ) {
                await this.cacheManager.set(
                    catalogKey,
                    { ...credentials, expiresAt },
                    ttl,
                );
                return credentials;
            }
        }
        if (systemError) throw providerFailure("Xbox:catalog", systemError);
        throw new ProviderSyncError(
            "unavailable",
            "Xbox catalog authentication credentials not available",
        );
    }
}
