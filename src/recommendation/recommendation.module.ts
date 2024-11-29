import { Module } from "@nestjs/common";
import { RecommendationService } from "./recommendation.service";
import { RecommendationController } from "./recommendation.controller";
import { CollectionsEntriesModule } from "../collections/collections-entries/collections-entries.module";
import { GameRepositoryModule } from "../game/game-repository/game-repository.module";
import { GameFilterModule } from "../game/game-filter/game-filter.module";

@Module({
    imports: [CollectionsEntriesModule, GameRepositoryModule, GameFilterModule],
    providers: [RecommendationService],
    controllers: [RecommendationController],
})
export class RecommendationModule {}
