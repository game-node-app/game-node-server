import { Module } from "@nestjs/common";
import { ExploreService } from "./explore.service";
import { ExploreController } from "./explore.controller";
import { StatisticsModule } from "../statistics/statistics.module";
import { GameRepositoryModule } from "../game/game-repository/game-repository.module";

@Module({
    imports: [StatisticsModule, GameRepositoryModule],
    providers: [ExploreService],
    controllers: [ExploreController],
})
export class ExploreModule {}
