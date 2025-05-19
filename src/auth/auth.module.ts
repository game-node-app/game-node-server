import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";

import { AuthMiddleware } from "./auth.middleware";
import { AuthService } from "./auth.service";
import { UserInitModule } from "../user-init/user-init.module";
import {
    SupertokensConfig,
    SupertokensConfigInjectionToken,
} from "./config.interface";
import { ConfigService } from "@nestjs/config";
import { AuthController } from "./auth.controller";
import { TurnstileModule } from "../turnstile/turnstile.module";
import axios from "axios";

@Module({
    imports: [UserInitModule, TurnstileModule],
    providers: [
        AuthService,
        {
            provide: SupertokensConfigInjectionToken,
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => {
                return {
                    appInfo: {
                        // Learn more about this on https://supertokens.com/docs/thirdparty/appinfo
                        appName: "GameNode",
                        apiDomain: configService.getOrThrow("DOMAIN_API"),
                        websiteDomain:
                            configService.getOrThrow("DOMAIN_WEBSITE"),
                        apiBasePath: "/v1/auth",
                        websiteBasePath: "/auth",
                    },
                    connectionURI: configService.getOrThrow(
                        "SUPERTOKENS_CORE_URI",
                    ),
                    /**
                     * This should be set if Supertokens Core is running in a public docker/host network.
                     */
                    apiKey: undefined,
                    providers: [
                        {
                            config: {
                                thirdPartyId: "google",
                                clients: [
                                    {
                                        clientId: configService.getOrThrow(
                                            "PROVIDER_GOOGLE_CLIENT_ID",
                                        ),
                                        clientSecret: configService.getOrThrow(
                                            "PROVIDER_GOOGLE_CLIENT_SECRET",
                                        ),
                                    },
                                ],
                            },
                        },
                        {
                            config: {
                                thirdPartyId: "discord",
                                clients: [
                                    {
                                        clientId: configService.getOrThrow(
                                            "PROVIDER_DISCORD_CLIENT_ID",
                                        ),
                                        clientSecret: configService.getOrThrow(
                                            "PROVIDER_DISCORD_CLIENT_ID",
                                        ),
                                    },
                                ],
                            },
                        },
                        {
                            config: {
                                thirdPartyId: "twitter",
                                clients: [
                                    {
                                        clientId: configService.getOrThrow(
                                            "PROVIDER_TWITTER_CLIENT_ID",
                                        ),
                                        clientSecret: configService.getOrThrow(
                                            "PROVIDER_TWITTER_CLIENT_SECRET",
                                        ),
                                    },
                                ],
                            },
                            override: (originalImplementation) => {
                                return {
                                    ...originalImplementation,
                                    exchangeAuthCodeForOAuthTokens: async (
                                        input,
                                    ) => {
                                        const result =
                                            await originalImplementation.exchangeAuthCodeForOAuthTokens!(
                                                input,
                                            );
                                        return result;
                                    },
                                };
                            },
                        },
                        {
                            config: {
                                thirdPartyId: "epicgames",
                                name: "EpicGames",
                                clients: [
                                    {
                                        clientId: configService.getOrThrow(
                                            "PROVIDER_EPICGAMES_CLIENT_ID",
                                        ),
                                        clientSecret: configService.getOrThrow(
                                            "PROVIDER_EPICGAMES_CLIENT_SECRET",
                                        ),
                                        scope: ["basic_profile", "email"],
                                    },
                                ],
                                tokenEndpoint:
                                    "https://api.epicgames.dev/epic/oauth/v2/token",
                                tokenEndpointBodyParams: {},
                                authorizationEndpoint:
                                    "https://www.epicgames.com/id/authorize",
                                jwksURI:
                                    "https://api.epicgames.dev/epic/oauth/v2/.well-known/jwks.json",
                                requireEmail: false,
                                generateFakeEmail: (input) => {
                                    return Promise.resolve(
                                        `${input.tenantId}-${input.thirdPartyUserId}@fakemail.com`,
                                    );
                                },
                            },
                            override: (originalImplementation) => ({
                                ...originalImplementation,
                                getUserInfo: async (input) => {
                                    return Promise.resolve({
                                        thirdPartyUserId:
                                            input.oAuthTokens["account_id"],
                                        rawUserInfoFromProvider:
                                            input.oAuthTokens,
                                    });
                                },
                                exchangeAuthCodeForOAuthTokens: async (
                                    input,
                                ) => {
                                    const { code } =
                                        input.redirectURIInfo
                                            .redirectURIQueryParams;

                                    const clientId: string =
                                        configService.getOrThrow(
                                            "PROVIDER_EPICGAMES_CLIENT_ID",
                                        );
                                    const clientSecret: string =
                                        configService.getOrThrow(
                                            "PROVIDER_EPICGAMES_CLIENT_SECRET",
                                        );

                                    const authBase64 = Buffer.from(
                                        `${clientId}:${clientSecret}`,
                                    ).toString("base64");

                                    const req = await axios.post(
                                        "https://api.epicgames.dev/epic/oauth/v2/token",
                                        {
                                            grant_type: "authorization_code",
                                            code: code,
                                        },
                                        {
                                            headers: {
                                                Authorization: `Basic ${authBase64}`,
                                                "Content-Type":
                                                    "application/x-www-form-urlencoded",
                                            },
                                        },
                                    );

                                    return req.data;
                                },
                            }),
                        },
                    ],
                } satisfies SupertokensConfig;
            },
        },
    ],
    controllers: [AuthController],
})
export class AuthModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer.apply(AuthMiddleware).forRoutes("*");
    }
}
