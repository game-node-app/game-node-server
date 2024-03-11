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
    ],
    exports: [SupertokensConfigInjectionToken, RabbitMQModule],
})
export class GlobalModule {}
