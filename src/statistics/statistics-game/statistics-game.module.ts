import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GameStatistics } from "../entity/game-statistics.entity";
import { UserLike } from "../entity/user-like.entity";
import { UserView } from "../entity/user-view.entity";
import { StatisticsGameService } from "./statistics-game.service";

@Module({
    imports: [TypeOrmModule.forFeature([GameStatistics, UserLike, UserView])],
    providers: [StatisticsGameService],
    exports: [StatisticsGameService],
})
export class StatisticsGameModule {}
