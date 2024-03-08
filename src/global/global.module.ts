import { Global, Module } from "@nestjs/common";
import * as process from "process";
import { SupertokensConfigInjectionToken } from "../auth/config.interface";
import { ConfigModule } from "@nestjs/config";
import { RabbitMQModule } from "@golevelup/nestjs-rabbitmq";

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
                    queues: [
                        {
                            name: "sync",
                            routingKey: "sync",
                            exchange: "sync",
                            options: {
                                durable: true,
                            },
                            createQueueIfNotExists: true,
                        },
                    ],
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
            },
            provide: SupertokensConfigInjectionToken,
        },
    ],
    exports: [SupertokensConfigInjectionToken, RabbitMQModule],
})
export class GlobalModule {}
