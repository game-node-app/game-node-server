import { forwardRef, Inject, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { randomUUID } from "node:crypto";
import { uncancellableProviderCall } from "../../player-sync-attempt";
import { providerFailure, ProviderSyncError } from "../../provider-sync.error";
import {
    acquireTokenLock,
    releaseTokenLock,
    renewTokenLock,
    TOKEN_LOCK_MS,
} from "../../connection-token-lock";
import { PLAYER_PROVIDER_BUDGET_QUEUE } from "../../player-provider-budget.service";
import { UserConnection } from "../../../connection/entity/user-connection.entity";
import { ConnectionCredentialService } from "../../../connection/connection-credential.service";
import { markReauthRequired } from "../../../connection/mark-reauth-required";
import {
    EConnectionAuthStatus,
    EConnectionType,
} from "../../../connection/connections.constants";
import { requestGogToken, toGogCredentials } from "../gog-oauth";

const SAFETY_BUFFER_MS = 5 * 60 * 1000;
@Injectable()
export class GogSyncAuthService {
    constructor(
        @InjectRepository(UserConnection)
        private readonly connectionRepository: Repository<UserConnection>,
        @Inject(forwardRef(() => ConnectionCredentialService))
        private readonly credentialService: ConnectionCredentialService,
        @InjectQueue(PLAYER_PROVIDER_BUDGET_QUEUE)
        private readonly queue: Queue,
    ) {}

    public async getCatalogueAccountId(): Promise<string> {
        const connections = await this.connectionRepository.find({
            where: {
                type: EConnectionType.GOG,
                authStatus: EConnectionAuthStatus.CONNECTED,
            },
        });
        for (const connection of connections) {
            try {
                await this.getAccessToken(connection.sourceUserId);
                return connection.sourceUserId;
            } catch {
                /* Try another connected account without exposing credentials. */
            }
        }
        throw new ProviderSyncError(
            "unavailable",
            "No usable GOG catalogue account",
        );
    }

    private isFresh(expiresAt?: Date | null) {
        return (
            !!expiresAt &&
            new Date(expiresAt).getTime() - Date.now() > SAFETY_BUFFER_MS
        );
    }

    public async getAccessToken(accountId: string): Promise<string> {
        const connection = await this.connectionRepository.findOne({
            where: {
                type: EConnectionType.GOG,
                sourceUserId: accountId,
            },
        });
        if (!connection) {
            throw new ProviderSyncError(
                "unavailable",
                `No GOG connection found for account ${accountId}`,
            );
        }
        if (connection.authStatus === EConnectionAuthStatus.REAUTH_REQUIRED) {
            throw new ProviderSyncError(
                "reauth_required",
                "GOG connection requires re-authentication",
            );
        }

        const credentials = await this.credentialService.getCredentials(
            connection.id,
        );
        if (credentials && this.isFresh(credentials.expiresAt))
            return credentials.accessToken;

        const lockKey = `gog-token-refresh-lock:${connection.id}`;
        const lockToken = randomUUID();
        if (!(await acquireTokenLock(this.queue, lockKey, lockToken))) {
            throw new ProviderSyncError(
                "unavailable",
                `Timeout acquiring GOG token refresh lock for connection ${connection.id}`,
            );
        }

        let lockLost = false;
        const renewal = setInterval(() => {
            renewTokenLock(this.queue, lockKey, lockToken)
                .then((result) => {
                    if (result !== 1) lockLost = true;
                })
                .catch(() => {
                    lockLost = true;
                });
        }, TOKEN_LOCK_MS / 3);
        const assertLock = async () => {
            const redis = await this.queue.client;
            if (lockLost || (await redis.get(lockKey)) !== lockToken)
                throw new ProviderSyncError(
                    "unavailable",
                    "GOG token refresh lock ownership lost",
                );
        };
        const requireReauth = async (message: string): Promise<never> => {
            await assertLock();
            await this.connectionRepository.manager.transaction((manager) =>
                markReauthRequired(manager, connection),
            );
            throw new ProviderSyncError("reauth_required", message);
        };

        try {
            // Another caller may have refreshed while we waited for the lock.
            const latest = await this.connectionRepository.findOne({
                where: { id: connection.id },
            });
            if (
                !latest ||
                latest.sourceUserId !== accountId ||
                latest.authStatus !== EConnectionAuthStatus.CONNECTED
            )
                throw new ProviderSyncError(
                    "unavailable",
                    "GOG connection changed during refresh",
                );
            const current = await this.credentialService.getCredentials(
                connection.id,
            );
            if (!current) return await requireReauth("Missing GOG credentials");
            if (this.isFresh(current.expiresAt)) return current.accessToken;

            if (!current.refreshToken) {
                return await requireReauth(
                    "No refresh token available for GOG connection",
                );
            }

            let token;
            try {
                token = await uncancellableProviderCall(
                    `gog:user:${accountId}`,
                    () =>
                        requestGogToken({
                            grant_type: "refresh_token",
                            refresh_token: current.refreshToken!,
                        }),
                );
            } catch (err: any) {
                if (
                    err instanceof ProviderSyncError &&
                    err.outcome === "reauth_required"
                ) {
                    return await requireReauth(
                        "GOG refresh token revoked or expired",
                    );
                }
                throw providerFailure("gog", err);
            }

            if (token.user_id !== undefined && token.user_id !== accountId) {
                throw new ProviderSyncError(
                    "incomplete",
                    "GOG refresh identity mismatch",
                );
            }
            await assertLock();
            const connected = await this.connectionRepository.findOne({
                where: { id: connection.id },
            });
            if (
                !connected ||
                connected.sourceUserId !== accountId ||
                connected.authStatus !== EConnectionAuthStatus.CONNECTED
            )
                throw new ProviderSyncError(
                    "unavailable",
                    "GOG connection changed during refresh",
                );
            await this.credentialService.saveCredentials(connection.id, {
                ...toGogCredentials(token),
                refreshToken: token.refresh_token ?? current.refreshToken,
            });
            return token.access_token;
        } finally {
            clearInterval(renewal);
            await releaseTokenLock(this.queue, lockKey, lockToken);
        }
    }
}
