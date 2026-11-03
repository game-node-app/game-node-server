import axios, { AxiosError } from "axios";
import { z } from "zod";
import { PlaintextConnectionCredentials } from "../../connection/connection-credential.service";
import { providerFailure, ProviderSyncError } from "../provider-sync.error";
import { GogProfile, GogTokenResponse } from "./gog-sync.types";

// Galaxy launcher protocol constants, pinned in contract-evidence.md; these are public client values.
export const GOG_CLIENT_ID = "46899977096215655";
const GOG_CLIENT_SECRET =
    "9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9";
export const GOG_AUTHORIZE_URL = "https://auth.gog.com/auth";
export const GOG_REDIRECT_URI =
    "https://embed.gog.com/on_login_success?origin=client";
export const GOG_TOKEN_URL = "https://auth.gog.com/token";
export const GOG_USERS_URL = "https://users.gog.com/users";

const accountId = z.string().regex(/^[1-9][0-9]*$/);
const tokenValue = z.string().regex(/^\S+$/);
const tokenResponse = z.object({
    access_token: tokenValue,
    refresh_token: tokenValue.optional(),
    expires_in: z.number().positive(),
    user_id: accountId.optional(),
});
const initialTokenResponse = tokenResponse.extend({
    refresh_token: tokenValue,
    user_id: accountId,
});
const profileResponse = z.object({
    id: accountId,
    username: z.string().regex(/\S/),
});

type GogGrant =
    | { grant_type: "authorization_code"; code: string }
    | { grant_type: "refresh_token"; refresh_token: string };

function requestFailure(cause: unknown, invalidRefresh = false) {
    const response = (cause as AxiosError<{ error?: unknown }> | null)
        ?.response;
    const failure = providerFailure("gog", cause);
    // Discard the raw Axios cause: even its message/config can contain token query values.
    return new ProviderSyncError(
        invalidRefresh &&
        response?.status === 400 &&
        response.data?.error === "invalid_grant"
            ? "reauth_required"
            : failure.outcome,
        "GOG authentication request failed",
        undefined,
        failure.status,
        failure.retryAfterMs,
    );
}

export async function requestGogToken(
    grant: GogGrant,
): Promise<GogTokenResponse> {
    let data: unknown;
    try {
        ({ data } = await axios.get<unknown>(GOG_TOKEN_URL, {
            params: {
                client_id: GOG_CLIENT_ID,
                client_secret: GOG_CLIENT_SECRET,
                ...(grant.grant_type === "authorization_code"
                    ? { redirect_uri: GOG_REDIRECT_URI }
                    : {}),
                ...grant,
            },
            timeout: 15_000,
            maxRedirects: 0,
        }));
    } catch (cause) {
        throw requestFailure(cause, grant.grant_type === "refresh_token");
    }
    const result = (
        grant.grant_type === "authorization_code"
            ? initialTokenResponse
            : tokenResponse
    ).safeParse(data);
    if (!result.success) {
        throw new ProviderSyncError("incomplete", "Invalid GOG token response");
    }
    toGogCredentials(result.data);
    return result.data;
}

export function toGogCredentials(
    token: GogTokenResponse,
): PlaintextConnectionCredentials {
    const now = Date.now();
    const expiresAt = new Date(now + token.expires_in * 1000);
    if (
        !Number.isFinite(token.expires_in) ||
        !Number.isFinite(expiresAt.getTime()) ||
        expiresAt.getTime() <= now
    ) {
        throw new ProviderSyncError("incomplete", "Invalid GOG token expiry");
    }
    return {
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? null,
        expiresAt,
        refreshTokenExpiresAt: null,
    };
}

export async function getGogProfile(
    userId: string,
    accessToken: string,
): Promise<GogProfile> {
    if (
        !accountId.safeParse(userId).success ||
        !tokenValue.safeParse(accessToken).success
    ) {
        throw new ProviderSyncError("incomplete", "Invalid GOG account ID");
    }
    let data: unknown;
    try {
        ({ data } = await axios.get<unknown>(`${GOG_USERS_URL}/${userId}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: 15_000,
            maxRedirects: 0,
        }));
    } catch (cause) {
        throw requestFailure(cause);
    }
    const result = profileResponse.safeParse(data);
    if (!result.success || result.data.id !== userId) {
        throw new ProviderSyncError(
            "incomplete",
            "Invalid GOG profile identity",
        );
    }
    return result.data;
}
