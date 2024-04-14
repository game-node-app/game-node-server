import { forwardRef, Module } from "@nestjs/common";
import { StatisticsController } from "./statistics.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserLike } from "./entity/user-like.entity";
import { UserView } from "./entity/user-view.entity";
import { NotificationsModule } from "../notifications/notifications.module";
import { GameStatisticsService } from "./game-statistics.service";
import { ReviewStatisticsService } from "./review-statistics.service";
import { GameStatistics } from "./entity/game-statistics.entity";
import { ReviewStatistics } from "./entity/review-statistics.entity";
import { GameRepositoryModule } from "../game/game-repository/game-repository.module";
import { ActivityStatisticsService } from "./activity-statistics.service";
import { ActivityStatistics } from "./entity/activity-statistics.entity";

@Module({
    imports: [
        TypeOrmModule.forFeature([
            UserLike,
            UserView,
            GameStatistics,
            ReviewStatistics,
            ActivityStatistics,
        ]),
        NotificationsModule,
        forwardRef(() => GameRepositoryModule),
    ],
    providers: [
        GameStatisticsService,
        ReviewStatisticsService,
        ActivityStatisticsService,
    ],
    controllers: [StatisticsController],
    exports: [GameStatisticsService, ReviewStatisticsService],
})
export class StatisticsModule {}
