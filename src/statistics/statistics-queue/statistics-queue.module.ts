import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bull";
import { StatisticsQueueService } from "./statistics-queue.service";
import { StatisticsQueueProcessor } from "./statistics-queue.processor";
import { StatisticsGameModule } from "../statistics-game/statistics-game.module";
import { StatisticsQueueGameController } from "./statistics-queue-game.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserLike } from "../entity/user-like.entity";
import { UserView } from "../entity/user-view.entity";
import { ReviewStatistics } from "../entity/review-statistics.entity";

@Module({
    imports: [
        BullModule.registerQueue({ name: "statistics" }),
        TypeOrmModule.forFeature([UserLike, UserView, ReviewStatistics]),
        StatisticsGameModule,
    ],
    controllers: [StatisticsQueueGameController],
    providers: [StatisticsQueueService, StatisticsQueueProcessor],
    exports: [StatisticsQueueService],
})
export class StatisticsQueueModule {}
