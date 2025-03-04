import { forwardRef, Module } from "@nestjs/common";
import { StatisticsController } from "./statistics.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserLike } from "./entity/user-like.entity";
import { UserView } from "./entity/user-view.entity";
import { NotificationsModule } from "../notifications/notifications.module";
import { GameStatistics } from "./entity/game-statistics.entity";
import { ReviewStatistics } from "./entity/review-statistics.entity";
import { GameRepositoryModule } from "../game/game-repository/game-repository.module";
import { ActivityStatistics } from "./entity/activity-statistics.entity";
import { CommentStatistics } from "./entity/comment-statistics.entity";
import { GameFilterModule } from "../game/game-filter/game-filter.module";
import { StatisticsService } from "./statistics.service";
import { StatisticsTrendingService } from "./statistics-trending.service";
import { PostStatistics } from "./entity/post-statistics.entity";

@Module({
    imports: [
        TypeOrmModule.forFeature([
            UserLike,
            UserView,
            GameStatistics,
            ReviewStatistics,
            ActivityStatistics,
            CommentStatistics,
            PostStatistics,
        ]),
        NotificationsModule,
        forwardRef(() => GameRepositoryModule),
        GameFilterModule,
    ],
    providers: [StatisticsService, StatisticsTrendingService],
    controllers: [StatisticsController],
    exports: [StatisticsService],
})
export class StatisticsModule {}
