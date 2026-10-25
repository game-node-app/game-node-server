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
import { SteamSyncService } from "./steam-sync.service";

@Injectable()
export class SteamConnectionAuthProvider
    implements ConnectionProviderAuthStrategy
{
    private readonly logger = new Logger(SteamConnectionAuthProvider.name);

    constructor(
        private readonly configService: ConfigService,
        private readonly steamSyncService: SteamSyncService,
    ) {}

    public async initRedirectAuth(
        params: RedirectAuthInitParams,
    ): Promise<RedirectAuthInitResult> {
        const domainWebsite =
            this.configService.get<string>("DOMAIN_WEBSITE") ||
            "http://localhost:3000";
        const cleanBaseUrl = domainWebsite.replace(/\/+$/, "");
        const returnToUrl = `${cleanBaseUrl}/connections/callback/steam`;
        const realm = cleanBaseUrl;

        const returnTo = `${returnToUrl}?state=${encodeURIComponent(params.state)}`;
        const urlParams = new URLSearchParams({
            "openid.ns": "http://specs.openid.net/auth/2.0",
            "openid.mode": "checkid_setup",
            "openid.return_to": returnTo,
            "openid.realm": realm,
            "openid.identity":
                "http://specs.openid.net/auth/2.0/identifier_select",
            "openid.claimed_id":
                "http://specs.openid.net/auth/2.0/identifier_select",
        });

        const authorizationUrl = `https://steamcommunity.com/openid/login?${urlParams.toString()}`;

        return {
            authorizationUrl,
            state: params.state,
            metadata: { returnTo },
        };
    }

    public async completeRedirectAuth(
        callbackParams: Record<string, any>,
        savedState: ConnectionAuthState,
    ): Promise<RedirectAuthCallbackResult> {
        if (!callbackParams || typeof callbackParams !== "object") {
            throw new HttpException(
                "Missing or invalid Steam callback parameters",
                HttpStatus.BAD_REQUEST,
            );
        }

        if (
            !savedState.metadata?.returnTo ||
            callbackParams["openid.return_to"] !== savedState.metadata.returnTo
        ) {
            throw new HttpException(
                "Steam callback return URL does not match the authentication request",
                HttpStatus.BAD_REQUEST,
            );
        }

        const mode = callbackParams["openid.mode"];
        if (mode !== "id_res") {
            throw new HttpException(
                `Steam authentication was not approved (mode: ${mode})`,
                HttpStatus.BAD_REQUEST,
            );
        }

        const claimedId = callbackParams["openid.claimed_id"];
        const identity = callbackParams["openid.identity"];

        if (!claimedId || !identity) {
            throw new HttpException(
                "Missing openid.claimed_id or openid.identity in callback",
                HttpStatus.BAD_REQUEST,
            );
        }

        const canonicalPattern =
            /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;
        const claimedMatch = String(claimedId).match(canonicalPattern);
        const identityMatch = String(identity).match(canonicalPattern);

        if (
            !claimedMatch ||
            !identityMatch ||
            claimedMatch[1] !== identityMatch[1]
        ) {
            throw new HttpException(
                "Malformed or mismatched Steam OpenID claimed_id/identity format",
                HttpStatus.BAD_REQUEST,
            );
        }

        const steamid64 = claimedMatch[1];

        // Verify with Steam check_authentication
        const verifyParams = new URLSearchParams();
        for (const [key, value] of Object.entries(callbackParams)) {
            if (key.startsWith("openid.")) {
                verifyParams.append(key, String(value));
            }
        }
        verifyParams.set("openid.mode", "check_authentication");

        try {
            const response = await axios.post(
                "https://steamcommunity.com/openid/login",
                verifyParams.toString(),
                {
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                    timeout: 15_000,
                },
            );

            const body =
                typeof response.data === "string"
                    ? response.data
                    : String(response.data);
            if (!body.split(/\r?\n/).includes("is_valid:true")) {
                throw new HttpException(
                    "Steam OpenID signature verification failed",
                    HttpStatus.BAD_REQUEST,
                );
            }
        } catch (err) {
            if (err instanceof HttpException) throw err;
            this.logger.error(
                "Error communicating with Steam OpenID server",
                err,
            );
            throw new HttpException(
                "Failed to verify Steam OpenID signature with Steam",
                HttpStatus.BAD_REQUEST,
            );
        }

        // Fetch user summary / nickname
        let sourceUsername = steamid64;
        try {
            const summary =
                await this.steamSyncService.getUserSummary(steamid64);
            if (summary && summary.nickname) {
                sourceUsername = summary.nickname;
            }
        } catch (err) {
            this.logger.warn(
                `Could not fetch Steam nickname for ${steamid64}`,
                err,
            );
        }

        return {
            sourceUserId: steamid64,
            sourceUsername,
        };
    }
}
