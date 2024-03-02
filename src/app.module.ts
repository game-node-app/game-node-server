import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import * as process from "process";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CacheModule } from "@nestjs/cache-manager";
import { ScheduleModule } from "@nestjs/schedule";
import { redisStore } from "cache-manager-redis-yet";
import { BullModule } from "@nestjs/bull";
import { LoggerMiddleware } from "./app.logger.middlewhare";
import { GlobalModule } from "./global/global.module";
import { CollectionsModule } from "./collections/collections.module";
import { CollectionsEntriesModule } from "./collections/collections-entries/collections-entries.module";
import { LibrariesModule } from "./libraries/libraries.module";
import { StatisticsModule } from "./statistics/statistics.module";
import { StatisticsQueueModule } from "./statistics/statistics-queue/statistics-queue.module";
import { ActivitiesFeedModule } from "./activities/activities-feed/activities-feed.module";
import { seconds, ThrottlerModule } from "@nestjs/throttler";
import { ThrottlerStorageRedisService } from "nestjs-throttler-storage-redis";
import { LevelModule } from "./level/level.module";
import { HealthModule } from "./health/health.module";
import { AchievementsModule } from "./achievements/achievements.module";
import { FollowModule } from "./follow/follow.module";
import { IgdbSyncModule } from "./sync/igdb/igdb-sync.module";
import { NotificationsModule } from './notifications/notifications.module';

/**
 * IMPORTANT: For any package that uses the "ioredis" module internally, make sure to use "forRootAsync".
 * and specify the hostname manually, otherwise it will not pick up in the docker network.
 * See "BullModule.forRootAsync" here for an example.
 */
@Module({
    imports: [
        ScheduleModule.forRoot(),
        GlobalModule,
        AuthModule,
        HealthModule,
        TypeOrmModule.forRoot({
            // Fixes Bigint values being returned as string
            // https://github.com/typeorm/typeorm/issues/2400#issuecomment-582643862
            bigNumberStrings: false,
            type: "mysql",
            retryAttempts: 999999,
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT as string) as any,
            username: process.env.DB_USER,
            password: process.env.DB_PASS,
            database: process.env.DB_DATABASE,
            autoLoadEntities: true,
            // Never turn this on. Use migrations instead.
            synchronize: false,
            logging: true,
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
        BullModule.forRootAsync({
            useFactory: async () => {
                /**
                 * While the "redis" property below accepts a string, and it works fine on local,
                 * it fails on Docker, so use host and port instead.
                 */
                const redisUrl = process.env.REDIS_URL;
                const redisHost = new URL(redisUrl!).hostname;
                const redisPort = new URL(redisUrl!).port;

                return {
                    redis: {
                        host: redisHost,
                        port: parseInt(redisPort as string) as any,
                        autoResubscribe: true,
                        reconnectOnError: () => {
                            return true;
                        },
                        maxRetriesPerRequest: null,
                    },
                    defaultJobOptions: {
                        removeOnComplete: true,
                        removeOnFail: true,
                        attempts: 10,
                        backoff: 5000,
                    },
                };
            },
        }),
        ThrottlerModule.forRootAsync({
            useFactory: () => {
                /**
                 * While the "redis" property below accepts a script, and it works fine on local,
                 * it fails on Docker, so use host and port instead.
                 */
                const redisUrl = process.env.REDIS_URL;
                const redisHost = new URL(redisUrl!).hostname;
                const redisPort = new URL(redisUrl!).port;
                return {
                    throttlers: [{ limit: 10, ttl: seconds(60) }],
                    storage: new ThrottlerStorageRedisService({
                        host: redisHost,
                        autoResubscribe: true,
                        port: redisPort,
                        reconnectOnError: () => {
                            return true;
                        },
                    } as any),
                };
            },
        }),
        ActivitiesFeedModule,
        IgdbSyncModule,
        CollectionsModule,
        CollectionsEntriesModule,
        LibrariesModule,
        CollectionsModule,
        StatisticsModule,
        StatisticsQueueModule,
        LevelModule,
        HealthModule,
        AchievementsModule,
        FollowModule,
        NotificationsModule,
    ],
})
export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer): void {
        consumer.apply(LoggerMiddleware).forRoutes("*");
    }
}
