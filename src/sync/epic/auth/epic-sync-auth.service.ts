import { forwardRef, Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
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
import {
    EConnectionAuthStatus,
    EConnectionType,
} from "../../../connection/connections.constants";
import { requestEpicToken, toEpicCredentials } from "../epic-oauth";

const SAFETY_BUFFER_MS = 5 * 60 * 1000;
const INVALID_REFRESH_TOKEN =
    "errors.com.epicgames.account.auth_token.invalid_refresh_token";

@Injectable()
export class EpicSyncAuthService {
    constructor(
        private readonly configService: ConfigService,
        @InjectRepository(UserConnection)
        private readonly connectionRepository: Repository<UserConnection>,
        @Inject(forwardRef(() => ConnectionCredentialService))
        private readonly credentialService: ConnectionCredentialService,
        @InjectQueue(PLAYER_PROVIDER_BUDGET_QUEUE)
        private readonly queue: Queue,
    ) {}

    private isFresh(expiresAt?: Date | null) {
        return (
            !!expiresAt &&
            new Date(expiresAt).getTime() - Date.now() > SAFETY_BUFFER_MS
        );
    }

    public async getAccessToken(accountId: string): Promise<string> {
        const connection = await this.connectionRepository.findOne({
            where: {
                type: EConnectionType.EPIC_GAMES,
                sourceUserId: accountId,
            },
        });
        if (!connection) {
            throw new ProviderSyncError(
                "unsupported",
                `No Epic Games connection found for account ${accountId}`,
            );
        }
        if (connection.authStatus === EConnectionAuthStatus.REAUTH_REQUIRED) {
            throw new ProviderSyncError(
                "reauth_required",
                "Epic Games connection requires re-authentication",
            );
        }

        const credentials = await this.credentialService.getCredentials(
            connection.id,
        );
        if (!credentials) {
            throw new ProviderSyncError(
                "failed",
                `Missing Epic Games credentials for connection ${connection.id}`,
            );
        }
        if (this.isFresh(credentials.expiresAt)) return credentials.accessToken;

        const lockKey = `epic-token-refresh-lock:${connection.id}`;
        const lockToken = randomUUID();
        if (!(await acquireTokenLock(this.queue, lockKey, lockToken))) {
            throw new ProviderSyncError(
                "unavailable",
                `Timeout acquiring Epic token refresh lock for connection ${connection.id}`,
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
                    "Epic token refresh lock ownership lost",
                );
        };
        const requireReauth = async (message: string): Promise<never> => {
            await assertLock();
            connection.authStatus = EConnectionAuthStatus.REAUTH_REQUIRED;
            await this.connectionRepository.save(connection);
            throw new ProviderSyncError("reauth_required", message);
        };

        try {
            // Another caller may have refreshed while we waited for the lock.
            const current =
                (await this.credentialService.getCredentials(connection.id)) ??
                credentials;
            if (this.isFresh(current.expiresAt)) return current.accessToken;

            if (!current.refreshToken) {
                return await requireReauth(
                    "No refresh token available for Epic Games connection",
                );
            }

            let token;
            try {
                token = await uncancellableProviderCall(
                    `epicgames:user:${accountId}`,
                    () =>
                        requestEpicToken(this.configService, {
                            grant_type: "refresh_token",
                            refresh_token: current.refreshToken!,
                        }),
                );
            } catch (err: any) {
                const cause =
                    err instanceof ProviderSyncError ? err.cause : err;
                const response = (cause as any)?.response;
                if (
                    (response?.status === 400 || response?.status === 401) &&
                    response?.data?.errorCode === INVALID_REFRESH_TOKEN
                ) {
                    return await requireReauth(
                        "Epic refresh token revoked or expired",
                    );
                }
                throw providerFailure("epicgames", err);
            }

            await assertLock();
            await this.credentialService.saveCredentials(
                connection.id,
                toEpicCredentials(token),
            );
            return token.access_token;
        } finally {
            clearInterval(renewal);
            await releaseTokenLock(this.queue, lockKey, lockToken);
        }
    }
}
