import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import {
    ConnectionProviderAuthStrategy,
    RedirectAuthCallbackResult,
    RedirectAuthInitParams,
    RedirectAuthInitResult,
} from "../../connection/connection-provider.registry";
import { ConnectionAuthState } from "../../connection/connection-auth-state.service";
import {
    getNintendoUser,
    NINTENDO_AUTHORIZE_URL,
    NINTENDO_CLIENT_ID,
    NINTENDO_REDIRECT_URI,
    NINTENDO_SCOPE,
    requestAccessToken,
    requestSessionToken,
} from "./nintendo-account";

const badRequest = (message: string) =>
    new HttpException(message, HttpStatus.BAD_REQUEST);

/** Reads the pasted "Select this account" link; anything else is a 400. */
function parseAccountLink(input: unknown): URLSearchParams {
    const prefix = `${NINTENDO_REDIRECT_URI}#`;
    const text = typeof input === "string" ? input.trim() : "";
    if (!text.startsWith(prefix)) {
        throw badRequest("Invalid Nintendo account link");
    }
    return new URLSearchParams(text.slice(prefix.length));
}

/** Display hint only: the session token is not verified here, Nintendo decides its validity. */
function sessionTokenExpiry(sessionToken: string): Date | null {
    try {
        const payload = JSON.parse(
            Buffer.from(sessionToken.split(".")[1], "base64url").toString(),
        );
        return typeof payload.exp === "number"
            ? new Date(payload.exp * 1000)
            : null;
    } catch {
        return null;
    }
}

@Injectable()
export class NintendoConnectionAuthProvider
    implements ConnectionProviderAuthStrategy
{
    private readonly logger = new Logger(NintendoConnectionAuthProvider.name);

    public async initRedirectAuth(
        params: RedirectAuthInitParams,
    ): Promise<RedirectAuthInitResult> {
        const codeVerifier = randomBytes(32).toString("base64url");
        const query = new URLSearchParams({
            client_id: NINTENDO_CLIENT_ID,
            redirect_uri: NINTENDO_REDIRECT_URI,
            scope: NINTENDO_SCOPE,
            response_type: "session_token_code",
            session_token_code_challenge: createHash("sha256")
                .update(codeVerifier)
                .digest("base64url"),
            session_token_code_challenge_method: "S256",
            state: params.state,
            theme: "login_form",
        });
        return {
            authorizationUrl: `${NINTENDO_AUTHORIZE_URL}?${query}`,
            state: params.state,
            codeVerifier,
            // The strategy only receives the consumed state object, which holds no copy of the state value.
            metadata: { state: params.state },
        };
    }

    public async completeRedirectAuth(
        callbackParams: Record<string, any>,
        savedState: ConnectionAuthState,
    ): Promise<RedirectAuthCallbackResult> {
        const fragment = parseAccountLink(callbackParams?.code);
        const code = fragment.get("session_token_code");
        if (!code || !savedState.codeVerifier) {
            throw badRequest("Invalid Nintendo account link");
        }
        if (fragment.get("state") !== savedState.metadata?.state) {
            throw badRequest("Nintendo account link is from another login");
        }
        try {
            const { session_token } = await requestSessionToken(
                code,
                savedState.codeVerifier,
            );
            const token = await requestAccessToken(session_token);
            const user = await getNintendoUser(token.access_token);
            return {
                sourceUserId: user.id,
                sourceUsername: user.nickname || user.id,
                credentials: {
                    accessToken: token.access_token,
                    expiresAt: new Date(Date.now() + token.expires_in * 1000),
                    refreshToken: session_token,
                    refreshTokenExpiresAt: sessionTokenExpiry(session_token),
                },
            };
        } catch (err: any) {
            const message =
                err.response?.data?.error ||
                err.response?.data?.errorCode ||
                err.message;
            this.logger.error("Nintendo code exchange failed", message);
            throw badRequest(`Failed to link Nintendo account: ${message}`);
        }
    }
}
