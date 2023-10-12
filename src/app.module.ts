import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
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
import { GlobalModule } from "./global/global.module";
import { GameModule } from "./game/game.module";
import { GameQueueModule } from "./game/game-queue/game-queue.module";

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
        StatisticsModule,
        GameQueueModule,
    ],
    providers: [],
})
export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer): void {
        consumer.apply(LoggerMiddleware).forRoutes("*");
    }
}
