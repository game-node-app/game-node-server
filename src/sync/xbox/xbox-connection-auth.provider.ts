import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import {
    ConnectionProviderAuthStrategy,
    RedirectAuthCallbackResult,
    RedirectAuthInitParams,
    RedirectAuthInitResult,
} from "../../connection/connection-provider.registry";
import { ConnectionAuthState } from "../../connection/connection-auth-state.service";

export const XBOX_XERR_MESSAGES: Record<number, string> = {
    2148916233:
        "The Microsoft account does not have an active Xbox Live profile. Please create one on xbox.com before connecting.",
    2148916235:
        "Xbox Live is not available in the account's registered country/region.",
    2148916236:
        "Adult verification is required for this account before connecting.",
    2148916237:
        "Adult verification is required for this account before connecting.",
    2148916238:
        "Child account requires family consent from a parent or guardian.",
};

@Injectable()
export class XboxConnectionAuthProvider implements ConnectionProviderAuthStrategy {
    private readonly logger = new Logger(XboxConnectionAuthProvider.name);

    constructor(private readonly configService: ConfigService) {}

    public async initRedirectAuth(
        params: RedirectAuthInitParams,
    ): Promise<RedirectAuthInitResult> {
        const clientId =
            this.configService.get<string>("XBOX_OAUTH_CLIENT_ID") || "";
        const redirectUri =
            this.configService.get<string>("XBOX_OAUTH_REDIRECT_URI") || "";

        const urlParams = new URLSearchParams({
            client_id: clientId,
            response_type: "code",
            redirect_uri: redirectUri,
            scope: "Xboxlive.signin Xboxlive.offline_access",
            response_mode: "query",
        });

        if (params.state) {
            urlParams.set("state", params.state);
        }

        const authorizationUrl = `https://login.live.com/oauth20_authorize.srf?${urlParams.toString()}`;

        return {
            authorizationUrl,
            state: params.state,
        };
    }

    public async completeRedirectAuth(
        callbackParams: Record<string, any>,
        savedState: ConnectionAuthState,
    ): Promise<RedirectAuthCallbackResult> {
        if (!callbackParams || typeof callbackParams !== "object") {
            throw new HttpException(
                "Missing or invalid Xbox callback parameters",
                HttpStatus.BAD_REQUEST,
            );
        }

        if (callbackParams.error) {
            throw new HttpException(
                callbackParams.error_description ||
                    `Microsoft authorization failed: ${callbackParams.error}`,
                HttpStatus.BAD_REQUEST,
            );
        }

        const code = callbackParams.code;
        if (!code || typeof code !== "string") {
            throw new HttpException(
                "Missing authorization code in callback parameters",
                HttpStatus.BAD_REQUEST,
            );
        }

        const clientId =
            this.configService.get<string>("XBOX_OAUTH_CLIENT_ID") || "";
        const clientSecret =
            this.configService.get<string>("XBOX_OAUTH_CLIENT_SECRET") || "";
        const redirectUri =
            this.configService.get<string>("XBOX_OAUTH_REDIRECT_URI") || "";

        // Step 1: Exchange code for Microsoft OAuth tokens
        let msTokens: {
            access_token: string;
            refresh_token?: string;
            expires_in?: number;
        };

        try {
            const tokenParams = new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                code,
                grant_type: "authorization_code",
                redirect_uri: redirectUri,
            });

            const tokenRes = await axios.post(
                "https://login.live.com/oauth20_token.srf",
                tokenParams.toString(),
                {
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                    timeout: 15_000,
                },
            );
            msTokens = tokenRes.data;
        } catch (err: any) {
            const errMsg =
                err.response?.data?.error_description ||
                err.response?.data?.error ||
                err.message;
            this.logger.error("Microsoft OAuth code exchange failed", errMsg);
            throw new HttpException(
                `Failed to exchange Microsoft authorization code: ${errMsg}`,
                HttpStatus.BAD_REQUEST,
            );
        }

        // Step 2: Authenticate with Xbox Live (user.auth.xboxlive.com)
        let xblToken: string;
        try {
            const xblRes = await axios.post(
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
            );
            xblToken = xblRes.data.Token;
        } catch (err: any) {
            this.handleXboxAuthError(err, "Xbox Live user authentication");
        }

        // Step 3: Authorize XSTS Token (xsts.auth.xboxlive.com)
        let xstsData: any;
        try {
            const xstsRes = await axios.post(
                "https://xsts.auth.xboxlive.com/xsts/authorize",
                {
                    RelyingParty: "http://xboxlive.com",
                    TokenType: "JWT",
                    Properties: {
                        SandboxId: "RETAIL",
                        UserTokens: [xblToken!],
                    },
                },
                {
                    headers: {
                        "Content-Type": "application/json",
                        Accept: "application/json",
                    },
                    timeout: 15_000,
                },
            );
            xstsData = xstsRes.data;
        } catch (err: any) {
            this.handleXboxAuthError(err, "Xbox XSTS token authorization");
        }

        const displayClaim = xstsData?.DisplayClaims?.xui?.[0];
        const xuid = displayClaim?.xid;
        const gamertag = displayClaim?.gtg;
        const userHash = displayClaim?.uhs;

        if (!xuid || !userHash) {
            throw new HttpException(
                "Failed to extract Xbox profile claims (xuid or userHash) from XSTS token",
                HttpStatus.BAD_REQUEST,
            );
        }

        const now = Date.now();
        const expiresInSec = msTokens.expires_in || 3600;
        const expiresAt = new Date(now + expiresInSec * 1000);

        return {
            sourceUserId: xuid,
            sourceUsername: gamertag || xuid,
            credentials: {
                accessToken: msTokens.access_token,
                refreshToken: msTokens.refresh_token ?? null,
                expiresAt,
                refreshTokenExpiresAt: null,
                providerMetadata: {
                    xstsToken: xstsData.Token,
                    userHash,
                    xstsExpiresAt: xstsData.NotAfter,
                },
            },
        };
    }

    private handleXboxAuthError(err: any, stage: string): never {
        const xerr = err.response?.data?.XErr;
        if (typeof xerr === "number") {
            const message =
                XBOX_XERR_MESSAGES[xerr] ||
                `Xbox Live authorization error (XErr: ${xerr})`;
            throw new HttpException(message, HttpStatus.BAD_REQUEST);
        }

        const errMsg =
            err.response?.data?.Message ||
            err.response?.data?.error ||
            err.message;
        this.logger.error(`${stage} failed`, errMsg);
        throw new HttpException(
            `${stage} failed: ${errMsg}`,
            HttpStatus.BAD_REQUEST,
        );
    }
}
