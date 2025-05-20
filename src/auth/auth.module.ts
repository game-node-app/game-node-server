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
