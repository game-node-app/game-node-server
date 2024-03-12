import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";

import { AuthMiddleware } from "./auth.middleware";
import { AuthService } from "./auth.service";
import { UserInitModule } from "../user-init/user-init.module";
import process from "process";
import {
    AuthModuleConfig,
    SupertokensConfigInjectionToken,
} from "./config.interface";
import { ConfigModule } from "@nestjs/config";

@Module({
    imports: [ConfigModule.forRoot(), UserInitModule],
    providers: [
        AuthService,
        {
            useValue: {
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
                smtpSettings: {
                    from: {
                        name: "GameNode",
                        email: "gamenode@gamenode.app",
                    },
                    host: process.env.EMAIL_HOST!,
                    port: process.env.EMAIL_PORT
                        ? parseInt(process.env.EMAIL_PORT!)
                        : (undefined as any as number),
                    secure: true,
                    password: process.env.EMAIL_PASSWORD!,
                    authUsername: process.env.EMAIL_USERNAME,
                },
                providers: [
                    {
                        config: {
                            thirdPartyId: "google",
                            clients: [
                                {
                                    clientId:
                                        process.env.PROVIDER_GOOGLE_CLIENT_ID!,
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
                                        process.env.PROVIDER_DISCORD_CLIENT_ID!,
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
                                        process.env.PROVIDER_TWITTER_CLIENT_ID!,
                                    clientSecret:
                                        process.env
                                            .PROVIDER_TWITTER_CLIENT_SECRET!,
                                },
                            ],
                        },
                    },
                ],
            } satisfies AuthModuleConfig,
            provide: SupertokensConfigInjectionToken,
        },
    ],
})
export class AuthModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer.apply(AuthMiddleware).forRoutes("*");
    }
}
