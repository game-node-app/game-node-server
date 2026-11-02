import { forwardRef, Inject, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { uncancellableProviderCall } from "../../player-sync-attempt";
import { providerFailure, ProviderSyncError } from "../../provider-sync.error";
import { UserConnection } from "../../../connection/entity/user-connection.entity";
import { ConnectionCredentialService } from "../../../connection/connection-credential.service";
import { markReauthRequired } from "../../../connection/mark-reauth-required";
import {
    EConnectionAuthStatus,
    EConnectionType,
} from "../../../connection/connections.constants";
import { requestAccessToken } from "../nintendo-account";

const SAFETY_BUFFER_MS = 5 * 60 * 1000;

@Injectable()
export class NintendoSyncAuthService {
    constructor(
        @InjectRepository(UserConnection)
        private readonly connectionRepository: Repository<UserConnection>,
        @Inject(forwardRef(() => ConnectionCredentialService))
        private readonly credentialService: ConnectionCredentialService,
    ) {}

    // No lock: the session token never rotates, so concurrent refreshes both get valid tokens and the last save wins harmlessly.
    public async getAccessToken(accountId: string): Promise<string> {
        const connection = await this.connectionRepository.findOne({
            where: { type: EConnectionType.NINTENDO, sourceUserId: accountId },
        });
        if (!connection) {
            throw new ProviderSyncError(
                "unsupported",
                `No Nintendo connection found for account ${accountId}`,
            );
        }
        if (connection.authStatus === EConnectionAuthStatus.REAUTH_REQUIRED) {
            throw new ProviderSyncError(
                "reauth_required",
                "Nintendo connection requires re-authentication",
            );
        }

        const credentials = await this.credentialService.getCredentials(
            connection.id,
        );
        if (!credentials) {
            throw new ProviderSyncError(
                "failed",
                `Missing Nintendo credentials for connection ${connection.id}`,
            );
        }
        if (
            credentials.expiresAt &&
            new Date(credentials.expiresAt).getTime() - Date.now() >
                SAFETY_BUFFER_MS
        ) {
            return credentials.accessToken;
        }

        const requireReauth = async (message: string): Promise<never> => {
            await this.connectionRepository.manager.transaction((manager) =>
                markReauthRequired(manager, connection),
            );
            throw new ProviderSyncError("reauth_required", message);
        };
        if (!credentials.refreshToken) {
            return requireReauth("No Nintendo session token available");
        }

        let token;
        try {
            token = await uncancellableProviderCall(
                `nintendo:user:${accountId}`,
                () => requestAccessToken(credentials.refreshToken!),
            );
        } catch (err: any) {
            const cause = err instanceof ProviderSyncError ? err.cause : err;
            const response = (cause as any)?.response;
            if (
                response?.status === 400 &&
                response?.data?.error === "invalid_grant"
            ) {
                return requireReauth("Nintendo session revoked or expired");
            }
            throw providerFailure("nintendo", err);
        }

        await this.credentialService.saveCredentials(connection.id, {
            ...credentials,
            accessToken: token.access_token,
            expiresAt: new Date(Date.now() + token.expires_in * 1000),
        });
        return token.access_token;
    }
}
