import { forwardRef, Module } from "@nestjs/common";
import { ActivitiesRepositoryService } from "./activities-repository.service";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Activity } from "./entities/activity.entity";
import { StatisticsQueueModule } from "../../statistics/statistics-queue/statistics-queue.module";
import { ActivitiesRepositoryController } from "./activities-repository.controller";
import { GameFilterModule } from "../../game/game-filter/game-filter.module";
import { SuspensionModule } from "../../suspension/suspension.module";
import { ReviewsModule } from "../../reviews/reviews.module";
import { CollectionsEntriesModule } from "../../collections/collections-entries/collections-entries.module";
import { GameRepositoryModule } from "../../game/game-repository/game-repository.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([Activity]),
        StatisticsQueueModule,
        GameFilterModule,
        SuspensionModule,
        forwardRef(() => ReviewsModule),
        forwardRef(() => CollectionsEntriesModule),
    ],
    providers: [ActivitiesRepositoryService],
    exports: [ActivitiesRepositoryService],
    controllers: [ActivitiesRepositoryController],
})
export class ActivitiesRepositoryModule {}
