import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bull";
import { StatisticsQueueService } from "./statistics.queue.service";
import { StatisticsProcessorService } from "./statistics.processor.service";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GameStatistics } from "./entity/game-statistics.entity";
import { ReviewStatistics } from "./entity/review-statistics.entity";
import { UserLike } from "./entity/user-like.entity";
import { UserView } from "./entity/user-view.entity";

@Module({
    imports: [
        BullModule.registerQueue({ name: "statistics" }),
        TypeOrmModule.forFeature([
            GameStatistics,
            ReviewStatistics,
            UserLike,
            UserView,
        ]),
    ],
    controllers: [],
    providers: [StatisticsQueueService, StatisticsProcessorService],
})
export class StatisticsModule {}
