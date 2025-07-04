import {
    HttpException,
    HttpStatus,
    Inject,
    Injectable,
    Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cache, CACHE_MANAGER } from "@nestjs/cache-manager";
import {
    authenticate,
    CredentialsAuthenticateInitialResponse,
} from "@xboxreplay/xboxlive-auth";
import dayjs from "dayjs";

@Injectable()
export class XboxSyncAuthService {
    private readonly logger = new Logger(XboxSyncAuthService.name);

    constructor(
        private readonly configService: ConfigService,
        @Inject(CACHE_MANAGER)
        private readonly cacheManager: Cache,
    ) {}

    private getStoreKey() {
        return `xbox-sync-auth-cred`;
    }

    private async persistCredentialsToStore(
        credentials: CredentialsAuthenticateInitialResponse,
    ) {
        const now = dayjs();
        const expiresAt = dayjs(credentials.expires_on);
        // millis to expireAt
        const diffInMs = expiresAt.diff(now, "milliseconds");

        await this.cacheManager.set(this.getStoreKey(), credentials, diffInMs);
        this.logger.log(
            `Persisted new sync credentials at ${dayjs().toISOString()} which expires at ${expiresAt.toISOString()}`,
        );
    }

    private async getCredentialsFromStore() {
        return this.cacheManager.get<CredentialsAuthenticateInitialResponse>(
            this.getStoreKey(),
        );
    }

    private async getCredentialsFromSource() {
        const clientId: string | undefined =
            this.configService.get("XBOX_API_USER");
        const clientSecret: string | undefined =
            this.configService.get("XBOX_API_PASS");

        if (clientId == undefined || clientSecret == undefined) {
            this.logger.warn(
                "No XBOX provider credentials provided. Xbox Sync services will not work.",
            );
            return;
        }

        let auth: CredentialsAuthenticateInitialResponse;

        try {
            auth = (await authenticate(
                clientId,
                clientSecret,
            )) as unknown as CredentialsAuthenticateInitialResponse;

            await this.persistCredentialsToStore(auth);
        } catch (err: unknown) {
            this.logger.error(err);
            throw new HttpException(
                `Xbox authentication failed: ${err}`,
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }

        return auth;
    }

    public async getAuthCredentials(): Promise<{
        XSTSToken: string;
        userHash: string;
    }> {
        const credentialsOnStore = await this.getCredentialsFromStore();

        if (credentialsOnStore) {
            return {
                XSTSToken: credentialsOnStore.xsts_token,
                userHash: credentialsOnStore.user_hash,
            };
        }

        const credentialsFromSource = await this.getCredentialsFromSource();

        if (credentialsFromSource == undefined) {
            throw new Error(
                "Xbox Sync credentials not provided or auth failed.",
            );
        }

        return {
            XSTSToken: credentialsFromSource.xsts_token,
            userHash: credentialsFromSource.user_hash,
        };
    }
}
