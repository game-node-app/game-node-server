import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import * as process from "process";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CacheModule } from "@nestjs/cache-manager";
import { ScheduleModule } from "@nestjs/schedule";
import { redisStore } from "cache-manager-redis-yet";
import { BullModule } from "@nestjs/bull";
import { LoggerMiddleware } from "./app.logger.middlewhare";
import { ActivitiesRepositoryModule } from "./activities/activities-repository/activities-repository.module";
import { StatisticsQueueModule } from "./statistics/statistics-queue/statistics-queue.module";
import { GlobalModule } from "./global/global.module";
import { GameQueueModule } from "./game/game-queue/game-queue.module";
import { CollectionsModule } from "./collections/collections.module";
import { CollectionsEntriesModule } from "./collections/collections-entries/collections-entries.module";
import { GameSearchModule } from "./game/game-search/game-search.module";
import { LibrariesModule } from "./libraries/libraries.module";

@Module({
    imports: [
        ScheduleModule.forRoot(),
        GlobalModule,
        AuthModule,
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
        StatisticsQueueModule,
        GameQueueModule,
        CollectionsModule,
        CollectionsEntriesModule,
        GameSearchModule,
        LibrariesModule,
        CollectionsModule,
    ],
    providers: [],
})
export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer): void {
        consumer.apply(LoggerMiddleware).forRoutes("*");
    }
}
