import { Global, Module } from "@nestjs/common";
import * as process from "process";
import {
    AuthModuleConfig,
    SupertokensConfigInjectionToken,
} from "../auth/config.interface";
import { ConfigModule } from "@nestjs/config";
import { RabbitMQModule } from "@golevelup/nestjs-rabbitmq";
import { IGDB_SYNC_RABBITMQ_QUEUE_CONFIG } from "../sync/igdb/igdb-sync.constants";

@Global()
@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
        }),
        /**
         * This module allows for easy integration with RabbitMQ by allowing us to mark
         * services' (injectables) methods as message handlers.
         * See 'igdb-sync.service.ts' for an example.
         */
        RabbitMQModule.forRootAsync(RabbitMQModule, {
            useFactory: () => {
                const rabbitUri = process.env.RABBITMQ_URI;
                if (!rabbitUri)
                    throw new Error("RABBITMQ_URI must be defined.");
                return {
                    exchanges: [
                        {
                            name: "sync",
                            type: "direct",
                            createExchangeIfNotExists: true,
                        },
                    ],
                    uri: rabbitUri,
                    queues: [IGDB_SYNC_RABBITMQ_QUEUE_CONFIG],
                };
            },
        }),
    ],
    providers: [
        // Add global providers here
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
                ],
            } satisfies AuthModuleConfig,
            provide: SupertokensConfigInjectionToken,
        },
    ],
    exports: [SupertokensConfigInjectionToken, RabbitMQModule],
})
export class GlobalModule {}
