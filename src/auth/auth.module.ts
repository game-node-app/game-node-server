import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";

import { AuthMiddleware } from "./auth.middleware";
import { AuthService } from "./auth.service";
import { UserInitModule } from "../user-init/user-init.module";
import process from "process";
import {
    SupertokensConfig,
    SupertokensConfigInjectionToken,
} from "./config.interface";
import { ConfigService } from "@nestjs/config";

@Module({
    imports: [UserInitModule],
    providers: [
        AuthService,
        {
            provide: SupertokensConfigInjectionToken,
            inject: [ConfigService],
            useFactory: () => {
                return {
                    appInfo: {
                        // Learn more about this on https://supertokens.com/docs/thirdparty/appinfo
                        appName: "GameNode",
                        apiDomain: process.env.DOMAIN_API as any,
                        websiteDomain: process.env.DOMAIN_WEBSITE as any,
                        apiBasePath: "/v1/auth",
                        websiteBasePath: "/auth",
                    },
                    connectionURI: process.env.SUPERTOKENS_CORE_URI as string,
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
                                        clientId:
                                            process.env
                                                .PROVIDER_GOOGLE_CLIENT_ID!,
                                        clientSecret:
                                            process.env
                                                .PROVIDER_GOOGLE_CLIENT_SECRET!,
                                    },
                                ],
                            },
                        },
                        {
                            config: {
                                thirdPartyId: "discord",
                                clients: [
                                    {
                                        clientId:
                                            process.env
                                                .PROVIDER_DISCORD_CLIENT_ID!,
                                        clientSecret:
                                            process.env
                                                .PROVIDER_DISCORD_CLIENT_SECRET!,
                                    },
                                ],
                            },
                        },
                        {
                            config: {
                                thirdPartyId: "twitter",
                                clients: [
                                    {
                                        clientId:
                                            process.env
                                                .PROVIDER_TWITTER_CLIENT_ID!,
                                        clientSecret:
                                            process.env
                                                .PROVIDER_TWITTER_CLIENT_SECRET!,
                                    },
                                ],
                            },
                        },
                    ],
                } satisfies SupertokensConfig;
            },
        },
    ],
})
export class AuthModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer.apply(AuthMiddleware).forRoutes("*");
    }
}
