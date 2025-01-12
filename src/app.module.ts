import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import * as process from "process";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CacheModule } from "@nestjs/cache-manager";
import { ScheduleModule } from "@nestjs/schedule";
import { redisStore } from "cache-manager-redis-yet";
import { BullModule } from "@nestjs/bullmq";
import { LoggerMiddleware } from "./app.logger.middlewhare";
import { GlobalModule } from "./global/global.module";
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
import { NotificationsModule } from "./notifications/notifications.module";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { SteamSyncModule } from "./sync/steam/steam-sync.module";
import { ConnectionsModule } from "./connections/connections.module";
import { CommentModule } from "./comment/comment.module";
import { ImporterWatchModule } from "./importer/importer-watch/importer-watch.module";
import { ReportModule } from "./report/report.module";
import { SuspensionModule } from "./suspension/suspension.module";
import { ProfileMetricsModule } from "./profile/profile-metrics/profile-metrics.module";
import { RecommendationModule } from "./recommendation/recommendation.module";
import { GameFilterModule } from "./game/game-filter/game-filter.module";
import { PsnSyncModule } from "./sync/psn/psn-sync.module";
import { PlaytimeWatchModule } from "./playtime/watch/playtime-watch.module";

/**
 * Should only be called after 'ConfigModule' is loaded (e.g. in useFactory)
 */
function getRedisConfig(target: "cache" | "bullmq" = "cache") {
    /**
     * While the "redis" property below accepts a string, and it works fine on local,
     * it fails on Docker, so use host and port instead.
     */
    let redisUrl = process.env.REDIS_URL;
    if (target === "bullmq") {
        redisUrl = process.env.BULLMQ_REDIS_URL;
    }
    const redisHost = new URL(redisUrl!).hostname;
    const redisPort = new URL(redisUrl!).port;

    return {
        url: redisUrl,
        host: redisHost,
        port: parseInt(redisPort, 10),
    } as const;
}

/**
 * IMPORTANT: For any package that uses the "ioredis" module internally, make sure to use "forRootAsync".
 * and specify the hostname manually, otherwise it will not pick up in the docker network.
 * See "BullModule.forRootAsync" here for an example.
 */
@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
        }),
        ScheduleModule.forRoot(),
        GlobalModule,
        AuthModule,
        HealthModule,
        TypeOrmModule.forRootAsync({
            inject: [ConfigService],
            useFactory: () => {
                const redisConfig = getRedisConfig();
                return {
                    // Fixes Bigint values being returned as string
                    // https://github.com/typeorm/typeorm/issues/2400#issuecomment-582643862
                    // This will cause issues if you actually use huge numbers (not our case)
                    bigNumberStrings: false,
                    type: "mysql",
                    retryAttempts: 999999,
                    host: process.env.DB_HOST,
                    port: parseInt(process.env.DB_PORT as string) as any,
                    timezone: "Z",
                    username: process.env.DB_USER,
                    password: process.env.DB_PASS,
                    database: process.env.DB_DATABASE,
                    autoLoadEntities: true,
                    // Never turn this on. Use migrations instead.
                    synchronize: false,

                    /**
                     * Allows us to cache select queries using ioredis. Default duration of 1000ms.
                     * https://orkhan.gitbook.io/typeorm/docs/caching
                     */
                    cache: {
                        type: "ioredis",
                        options: {
                            host: redisConfig.host,
                            port: redisConfig.port,
                        },
                        ignoreErrors: true,
                    },
                };
            },
        }),
        CacheModule.registerAsync({
            isGlobal: true,
            inject: [ConfigService],
            useFactory: async () => ({
                store: await redisStore({
                    url: getRedisConfig().url,
                }),
            }),
        }),
        BullModule.forRootAsync({
            inject: [ConfigService],
            useFactory: async () => {
                const { port, host } = getRedisConfig("bullmq");

                return {
                    connection: {
                        host: host,
                        port: port,
                    },
                    defaultJobOptions: {
                        removeOnComplete: true,
                        removeOnFail: true,
                        // TODO: Decrease this once we figure the cause of the dreaded mysql access error
                        attempts: 15,
                        backoff: {
                            type: "fixed",
                            delay: seconds(2),
                        },
                    },
                };
            },
        }),
        ThrottlerModule.forRootAsync({
            useFactory: () => {
                const { port, host } = getRedisConfig();
                return {
                    throttlers: [{ limit: 10, ttl: seconds(60) }],
                    storage: new ThrottlerStorageRedisService({
                        host: host,
                        autoResubscribe: true,
                        port: port,
                        reconnectOnError: () => {
                            return true;
                        },
                    } as any),
                };
            },
        }),
        ActivitiesFeedModule,
        IgdbSyncModule,
        StatisticsModule,
        StatisticsQueueModule,
        ProfileMetricsModule,
        LevelModule,
        HealthModule,
        AchievementsModule,
        FollowModule,
        NotificationsModule,
        SteamSyncModule,
        ImporterWatchModule,
        ConnectionsModule,
        CommentModule,
        ReportModule,
        SuspensionModule,
        RecommendationModule,
        PlaytimeWatchModule,
        GameFilterModule,
        PsnSyncModule,
    ],
})
export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer): void {
        consumer.apply(LoggerMiddleware).forRoutes("*");
    }
}
