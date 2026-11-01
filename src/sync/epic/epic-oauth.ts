import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { PlaintextConnectionCredentials } from "../../connection/connection-credential.service";

export const EPIC_TOKEN_URL =
    "https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token";

export interface EpicTokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_at: string;
    refresh_expires_at?: string;
    account_id: string;
    displayName?: string;
}

export function getEpicClient(config: ConfigService) {
    return {
        clientId: config.get<string>("EPIC_OAUTH_CLIENT_ID") || "",
        clientSecret: config.get<string>("EPIC_OAUTH_CLIENT_SECRET") || "",
    };
}

/** Posts to Epic's token endpoint as the launcher client; throws the raw axios error. */
export async function requestEpicToken(
    config: ConfigService,
    grant: Record<string, string>,
): Promise<EpicTokenResponse> {
    const { clientId, clientSecret } = getEpicClient(config);
    const res = await axios.post(
        EPIC_TOKEN_URL,
        new URLSearchParams({ ...grant, token_type: "eg1" }).toString(),
        {
            auth: { username: clientId, password: clientSecret },
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            timeout: 15_000,
        },
    );
    return res.data;
}

export function toEpicCredentials(
    token: EpicTokenResponse,
): PlaintextConnectionCredentials {
    return {
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? null,
        expiresAt: new Date(token.expires_at),
        refreshTokenExpiresAt: token.refresh_expires_at
            ? new Date(token.refresh_expires_at)
            : null,
    };
}
