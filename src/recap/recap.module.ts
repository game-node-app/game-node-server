import { Module } from "@nestjs/common";
import { RecapService } from "./recap.service";
import { PlaytimeModule } from "../playtime/playtime.module";
import { RecapController } from "./recap.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { YearRecap } from "./entity/year-recap.entity";
import { YearRecapGenre } from "./entity/year-recap-genre.entity";
import { YearRecapMode } from "./entity/year-recap-mode.entity";
import { YearRecapPlatform } from "./entity/year-recap-platform.entity";
import { YearRecapPlayedGame } from "./entity/year-recap-played-game.entity";
import { YearRecapTheme } from "./entity/year-recap-theme.entity";
import { RecapCreateService } from "./recap-create.service";
import { RecapQueueService } from "./queue/recap-queue.service";
import { ProfileMetricsModule } from "../profile/profile-metrics/profile-metrics.module";
import { CollectionsModule } from "../collections/collections.module";
import { CollectionsEntriesModule } from "../collections/collections-entries/collections-entries.module";
import { ReviewsModule } from "../reviews/reviews.module";
import { FollowModule } from "../follow/follow.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([
            YearRecap,
            YearRecapGenre,
            YearRecapMode,
            YearRecapPlatform,
            YearRecapPlayedGame,
            YearRecapTheme,
        ]),
        CollectionsModule,
        CollectionsEntriesModule,
        PlaytimeModule,
        ProfileMetricsModule,
        ReviewsModule,
        FollowModule,
    ],
    providers: [RecapService, RecapCreateService, RecapQueueService],
    controllers: [RecapController],
})
export class RecapModule {}
