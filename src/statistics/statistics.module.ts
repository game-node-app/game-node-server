import { Module } from "@nestjs/common";
import { StatisticsService } from "./statistics.service";
import { StatisticsController } from "./statistics.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserLike } from "./entity/user-like.entity";
import { UserView } from "./entity/user-view.entity";
import { Statistics } from "./entity/statistics.entity";

@Module({
    imports: [TypeOrmModule.forFeature([UserLike, UserView, Statistics])],
    providers: [StatisticsService],
    controllers: [StatisticsController],
    exports: [StatisticsService],
})
export class StatisticsModule {}
