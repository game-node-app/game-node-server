import { MiddlewareConsumer, Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { AuthModule } from "./auth/auth.module";
import { ConfigModule } from "@nestjs/config";
import * as process from "process";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CacheModule } from "@nestjs/cache-manager";
import { ScheduleModule } from "@nestjs/schedule";
import { redisStore } from "cache-manager-redis-yet";
import { BullModule } from "@nestjs/bull";
import { LoggerMiddleware } from "./app.logger.middlewhare";
import { ActivitiesRepositoryModule } from "./activities/activities-repository/activities-repository.module";
import { StatisticsModule } from "./statistics/statistics.module";

@Module({
    imports: [
        ScheduleModule.forRoot(),
        ConfigModule.forRoot(),
        AuthModule.forRoot({
            // https://try.supertokens.com is for demo purposes.
            // Replace this with the address of your core instance (sign up on supertokens.com),
            // or self-host a core.
            connectionURI: process.env.SUPERTOKENS_CORE_URI as string,
            // apiKey: <API_KEY(if configured)>,
            appInfo: {
                // Learn more about this on https://supertokens.com/docs/thirdparty/appinfo
                appName: "GameNode",
                apiDomain: process.env.DOMAIN_API as any,
                websiteDomain: process.env.DOMAIN_WEBSITE as any,
                apiBasePath: process.env.DOMAIN_API_BASE as any,
                websiteBasePath: process.env.DOMAIN_WEBSITE_BASE as any,
            },
        }),
        TypeOrmModule.forRoot({
            type: "mysql",
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT as string) as any,
            username: process.env.DB_USER,
            password: process.env.DB_PASS,
            database: process.env.DB_DATABASE,
            autoLoadEntities: true,
            // Never turn this on. Use migrations instead.
            synchronize: false,
            logging: false,
            debug: false,
        }),

        CacheModule.registerAsync({
            isGlobal: true,
            useFactory: async () => ({
                store: await redisStore({
                    url: process.env.REDIS_URL,
                }),
            }),
        }),
        BullModule.forRoot({
            redis: process.env.REDIS_URL,
        }),
        ActivitiesRepositoryModule,
        StatisticsModule,
    ],
    controllers: [AppController],
    providers: [AppService],
})
export class AppModule {
    configure(consumer: MiddlewareConsumer): void {
        consumer.apply(LoggerMiddleware).forRoutes("*");
    }
}
