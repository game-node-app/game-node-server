import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { AuthModule } from "./auth/auth.module";
import { ConfigModule, ConfigService } from "@nestjs/config";
import * as process from "process";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CollectionsModule } from "./collections/collections.module";
import { LibrariesModule } from "./libraries/libraries.module";
import { IgdbModule } from "./igdb/igdb.module";
import { CacheModule } from "@nestjs/cache-manager";
import { ScheduleModule } from "@nestjs/schedule";
import { redisStore } from "cache-manager-redis-yet";
import { BullModule } from "@nestjs/bull";
import { StatisticsModule } from "./statistics/statistics.module";
import { ReviewsModule } from "./reviews/reviews.module";
import { ProfileModule } from './profile/profile.module';

@Module({
    imports: [
        ScheduleModule.forRoot(),
        ConfigModule.forRoot(),
        AuthModule.forRoot({
            // https://try.supertokens.com is for demo purposes. Replace this with the address of your core instance (sign up on supertokens.com), or self host a core.
            connectionURI: process.env.SUPERTOKENS_CORE_URI as string,
            // apiKey: <API_KEY(if configured)>,
            appInfo: {
                // Learn more about this on https://supertokens.com/docs/thirdparty/appinfo
                appName: "GameNode",
                apiDomain: process.env.DOMAIN_API as any,
                websiteDomain: process.env.DOMAIN_WEBSITE as any,
                apiBasePath: "/v1/auth",
                websiteBasePath: "/auth",
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
            synchronize: false,
        }),
        CollectionsModule,
        LibrariesModule,
        IgdbModule,
        CacheModule.registerAsync({
            isGlobal: true,
            useFactory: async () => ({
                store: await redisStore({
                    url: process.env.REDIS_URL,
                }),
            }),
        }),
        BullModule.forRoot({
            redis: {
                host: process.env.REDIS_HOST,
                port: parseInt(process.env.REDIS_PORT as string),
            },
        }),
        StatisticsModule,
        ReviewsModule,
        ProfileModule,
    ],
    controllers: [AppController],
    providers: [AppService],
})
export class AppModule {}
