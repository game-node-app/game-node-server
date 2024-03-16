import { Module } from "@nestjs/common";
import { StatisticsService } from "./statistics.service";
import { StatisticsController } from "./statistics.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserLike } from "./entity/user-like.entity";
import { UserView } from "./entity/user-view.entity";
import { Statistics } from "./entity/statistics.entity";
import { NotificationsModule } from "../notifications/notifications.module";
import { GameRepositoryModule } from "../game/game-repository/game-repository.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([UserLike, UserView, Statistics]),
        NotificationsModule,
        GameRepositoryModule,
    ],
    providers: [StatisticsService],
    controllers: [StatisticsController],
    exports: [StatisticsService],
})
export class StatisticsModule {}
