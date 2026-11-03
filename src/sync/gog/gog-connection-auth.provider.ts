import { BadRequestException, Injectable } from "@nestjs/common";
import {
    ConnectionProviderAuthStrategy,
    RedirectAuthCallbackResult,
    RedirectAuthInitParams,
    RedirectAuthInitResult,
} from "../../connection/connection-provider.registry";
import {
    getGogProfile,
    GOG_AUTHORIZE_URL,
    GOG_CLIENT_ID,
    GOG_REDIRECT_URI,
    requestGogToken,
    toGogCredentials,
} from "./gog-oauth";

function parseCode(input: unknown): string {
    try {
        if (typeof input !== "string" || input.length > 8192) throw Error();
        const url = new URL(input);
        const codes = url.searchParams.getAll("code");
        if (
            url.protocol !== "https:" ||
            url.hostname !== "embed.gog.com" ||
            url.port ||
            url.username ||
            url.password ||
            url.hash ||
            url.pathname !== "/on_login_success" ||
            url.searchParams.getAll("origin").length !== 1 ||
            url.searchParams.get("origin") !== "client" ||
            codes.length !== 1 ||
            !codes[0] ||
            codes[0].length > 2048 ||
            /\s/.test(codes[0])
        )
            throw Error();
        return codes[0];
    } catch {
        throw new BadRequestException("Invalid GOG login-success URL");
    }
}

@Injectable()
export class GogConnectionAuthProvider
    implements ConnectionProviderAuthStrategy
{
    public async initRedirectAuth(
        params: RedirectAuthInitParams,
    ): Promise<RedirectAuthInitResult> {
        const url = new URL(GOG_AUTHORIZE_URL);
        url.search = new URLSearchParams({
            client_id: GOG_CLIENT_ID,
            redirect_uri: GOG_REDIRECT_URI,
            response_type: "code",
            layout: "galaxy",
        }).toString();
        return { authorizationUrl: url.toString(), state: params.state };
    }

    public async completeRedirectAuth(
        callbackParams: Record<string, unknown>,
    ): Promise<RedirectAuthCallbackResult> {
        const code = parseCode(callbackParams?.code);
        try {
            const token = await requestGogToken({
                grant_type: "authorization_code",
                code,
            });
            const profile = await getGogProfile(
                token.user_id!,
                token.access_token,
            );
            return {
                sourceUserId: profile.id,
                sourceUsername: profile.username,
                credentials: toGogCredentials(token),
            };
        } catch {
            throw new BadRequestException("Failed to authenticate GOG account");
        }
    }
}
