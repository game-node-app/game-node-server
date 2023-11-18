import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GameStatistics } from "./entity/game-statistics.entity";
import { UserLike } from "../entity/user-like.entity";
import { UserView } from "../entity/user-view.entity";
import { StatisticsGameService } from "./statistics-game.service";
import { BullModule } from "@nestjs/bull";
import { ReviewStatistics } from "../statistics-review/entity/review-statistics.entity";
import { StatisticsGameQueueController } from "./statistics-game-queue.controller";
import { StatisticsGameQueueService } from "./statistics-game-queue.service";
import { StatisticsGameQueueProcessor } from "./statistics-game-queue.processor";
import { StatisticsGameController } from "./statistics-game.controller";

@Module({
    imports: [
        BullModule.registerQueue({ name: "statistics" }),
        TypeOrmModule.forFeature([
            UserLike,
            UserView,
            ReviewStatistics,
            GameStatistics,
        ]),
    ],
    controllers: [StatisticsGameQueueController, StatisticsGameController],
    providers: [
        StatisticsGameQueueService,
        StatisticsGameQueueProcessor,
        StatisticsGameService,
    ],
    exports: [StatisticsGameQueueService],
})
export class StatisticsGameModule {}
