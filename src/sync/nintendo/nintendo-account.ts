import axios from "axios";

// The Nintendo Store app's public client; there is no secret, so these are constants rather than config.
export const NINTENDO_CLIENT_ID = "5c38e31cd085304b";
export const NINTENDO_REDIRECT_URI = `npf${NINTENDO_CLIENT_ID}://auth`;
export const NINTENDO_SCOPE = "openid user user.mii user.email user.links[].id";
export const NINTENDO_AUTHORIZE_URL =
    "https://accounts.nintendo.com/connect/1.0.0/authorize";
const SESSION_TOKEN_URL =
    "https://accounts.nintendo.com/connect/1.0.0/api/session_token";
const TOKEN_URL = "https://accounts.nintendo.com/connect/1.0.0/api/token";
const USER_URL = "https://api.accounts.nintendo.com/2.0.0/users/me";
export const NINTENDO_PLAY_HISTORY_URL =
    "https://app-api.znej.nintendo.com/api/v2.0/users/me/play_histories";

/** English names keep unmapped-title curation consistent; Nintendo rejects play history without it. */
export const NINTENDO_LOCALE = "en-US";
export const NINTENDO_USER_AGENT = "GameNode (https://gamenode.com.br)";

export interface NintendoTokenResponse {
    access_token: string;
    expires_in: number;
}

export interface NintendoUser {
    id: string;
    nickname?: string;
}

const TIMEOUT = 15_000;
const HEADERS = { "User-Agent": NINTENDO_USER_AGENT };

/** All helpers throw the raw axios error. */
export async function requestSessionToken(
    code: string,
    verifier: string,
): Promise<{ session_token: string }> {
    const res = await axios.post(
        SESSION_TOKEN_URL,
        new URLSearchParams({
            client_id: NINTENDO_CLIENT_ID,
            session_token_code: code,
            session_token_code_verifier: verifier,
        }).toString(),
        {
            headers: {
                ...HEADERS,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            timeout: TIMEOUT,
        },
    );
    return res.data;
}

export async function requestAccessToken(
    sessionToken: string,
): Promise<NintendoTokenResponse> {
    const res = await axios.post(
        TOKEN_URL,
        {
            client_id: NINTENDO_CLIENT_ID,
            session_token: sessionToken,
            grant_type:
                "urn:ietf:params:oauth:grant-type:jwt-bearer-session-token",
        },
        {
            headers: { ...HEADERS, "Content-Type": "application/json" },
            timeout: TIMEOUT,
        },
    );
    return res.data;
}

export async function getNintendoUser(
    accessToken: string,
): Promise<NintendoUser> {
    const res = await axios.get(USER_URL, {
        headers: { ...HEADERS, Authorization: `Bearer ${accessToken}` },
        timeout: TIMEOUT,
    });
    return res.data;
}
