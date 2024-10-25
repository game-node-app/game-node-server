import { Global, Module } from "@nestjs/common";
import * as process from "process";
import { ConfigService } from "@nestjs/config";
import { RabbitMQModule } from "@golevelup/nestjs-rabbitmq";
import { IGDB_SYNC_RABBITMQ_QUEUE_CONFIG } from "../sync/igdb/igdb-sync.constants";
import { EMAIL_CONFIG_TOKEN } from "./global.tokens";
import { SMTPServiceConfig } from "supertokens-node/lib/build/ingredients/emaildelivery/services/smtp";
import {
    HLTB_SYNC_REQUEST_RMQ_QUEUE,
    HLTB_SYNC_RESPONSE_RMQ_QUEUE,
} from "../sync/hltb/hltb-sync.constants";

@Global()
@Module({
    imports: [
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
                        {
                            name: "sync-hltb",
                            type: "direct",
                            createExchangeIfNotExists: true,
                        },
                    ],
                    connectionInitOptions: {
                        wait: false,
                    },
                    uri: rabbitUri,
                    queues: [
                        IGDB_SYNC_RABBITMQ_QUEUE_CONFIG,
                        HLTB_SYNC_REQUEST_RMQ_QUEUE,
                        HLTB_SYNC_RESPONSE_RMQ_QUEUE,
                    ],
                };
            },
        }),
    ],
    providers: [
        // Add global providers here
        {
            provide: EMAIL_CONFIG_TOKEN,
            useFactory: (configService: ConfigService) => {
                return {
                    from: {
                        name: "GameNode",
                        email: configService.get("EMAIL_FROM")!,
                    },
                    host: configService.get("EMAIL_HOST")!,
                    port: configService.get("EMAIL_PORT")
                        ? parseInt(configService.get("EMAIL_PORT")!)
                        : 465,
                    secure: true,
                    password: configService.get("EMAIL_PASSWORD")!,
                    authUsername: configService.get("EMAIL_USERNAME"),
                } satisfies SMTPServiceConfig;
            },
            inject: [ConfigService],
        },
    ],
    exports: [RabbitMQModule, EMAIL_CONFIG_TOKEN],
})
export class GlobalModule {}
