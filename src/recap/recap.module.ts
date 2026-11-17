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
import { YearRecapEdition } from "./entity/year-recap-edition.entity";
import { YearGoal } from "./entity/year-goal.entity";
import { RecapCreateService } from "./recap-create.service";
import { RecapQueueService } from "./queue/recap-queue.service";
import { RecapWindowService } from "./recap-window.service";
import { RecapGoalsService } from "./recap-goals.service";
import { RecapAdminController } from "./recap-admin.controller";
import { ProfileMetricsModule } from "../profile/profile-metrics/profile-metrics.module";
import { CollectionsModule } from "../collections/collections.module";
import { CollectionsEntriesModule } from "../collections/collections-entries/collections-entries.module";
import { ReviewsModule } from "../reviews/reviews.module";
import { FollowModule } from "../follow/follow.module";
import { BullModule } from "@nestjs/bullmq";
import { RECAP_QUEUE_NAME } from "./recap.constants";
import { RecapQueueProcessor } from "./queue/recap-queue.processor";
import { ProfileModule } from "../profile/profile.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { LibrariesModule } from "../libraries/libraries.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([
            YearRecap,
            YearRecapGenre,
            YearRecapMode,
            YearRecapPlatform,
            YearRecapPlayedGame,
            YearRecapTheme,
            YearRecapEdition,
            YearGoal,
        ]),
        BullModule.registerQueue({
            name: RECAP_QUEUE_NAME,
            defaultJobOptions: {
                attempts: 3,
            },
        }),
        CollectionsModule,
        CollectionsEntriesModule,
        PlaytimeModule,
        ProfileMetricsModule,
        ReviewsModule,
        FollowModule,
        ProfileModule,
        NotificationsModule,
        LibrariesModule,
    ],
    providers: [
        RecapService,
        RecapCreateService,
        RecapQueueService,
        RecapQueueProcessor,
        RecapWindowService,
        RecapGoalsService,
    ],
    controllers: [RecapController, RecapAdminController],
    exports: [RecapWindowService],
})
export class RecapModule {}
