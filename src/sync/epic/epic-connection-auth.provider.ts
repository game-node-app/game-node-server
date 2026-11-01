import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
    ConnectionProviderAuthStrategy,
    RedirectAuthCallbackResult,
    RedirectAuthInitParams,
    RedirectAuthInitResult,
} from "../../connection/connection-provider.registry";
import {
    getEpicClient,
    requestEpicToken,
    toEpicCredentials,
} from "./epic-oauth";

const EPIC_CODE_PATTERN = /^[0-9a-f]{32}$/i;

/** Accepts the raw code or the JSON page body Epic displays; anything else is a 400. */
function parseEpicCode(input: unknown): string {
    if (typeof input === "string") {
        const text = input.trim();
        if (EPIC_CODE_PATTERN.test(text)) return text;
        try {
            const code = JSON.parse(text)?.authorizationCode;
            if (typeof code === "string" && EPIC_CODE_PATTERN.test(code))
                return code;
        } catch {
            // falls through to the 400 below
        }
    }
    throw new HttpException(
        "Invalid Epic authorization code",
        HttpStatus.BAD_REQUEST,
    );
}

@Injectable()
export class EpicConnectionAuthProvider
    implements ConnectionProviderAuthStrategy
{
    private readonly logger = new Logger(EpicConnectionAuthProvider.name);

    constructor(private readonly configService: ConfigService) {}

    public async initRedirectAuth(
        params: RedirectAuthInitParams,
    ): Promise<RedirectAuthInitResult> {
        const { clientId, clientSecret } = getEpicClient(this.configService);
        if (!clientId || !clientSecret) {
            throw new HttpException(
                "Epic Games connections are not configured",
                HttpStatus.BAD_REQUEST,
            );
        }
        const redirect = `https://www.epicgames.com/id/api/redirect?clientId=${clientId}&responseType=code`;
        return {
            // Epic shows the code on its own page and never redirects back, so the state is not sent to it.
            authorizationUrl: `https://www.epicgames.com/id/login?redirectUrl=${encodeURIComponent(redirect)}`,
            state: params.state,
        };
    }

    public async completeRedirectAuth(
        callbackParams: Record<string, any>,
    ): Promise<RedirectAuthCallbackResult> {
        const code = parseEpicCode(callbackParams?.code);
        try {
            const token = await requestEpicToken(this.configService, {
                grant_type: "authorization_code",
                code,
            });
            return {
                sourceUserId: token.account_id,
                sourceUsername: token.displayName || token.account_id,
                credentials: toEpicCredentials(token),
            };
        } catch (err: any) {
            const message =
                err.response?.data?.errorMessage ||
                err.response?.data?.errorCode ||
                err.message;
            this.logger.error("Epic code exchange failed", message);
            throw new HttpException(
                `Failed to exchange Epic authorization code: ${message}`,
                HttpStatus.BAD_REQUEST,
            );
        }
    }
}
