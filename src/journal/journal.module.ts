import { Module } from "@nestjs/common";
import { JournalService } from "./journal.service";
import { JournalController } from "./journal.controller";
import { CollectionsEntriesModule } from "../collections/collections-entries/collections-entries.module";
import { GameAchievementModule } from "../game/game-achievement/game-achievement.module";
import { JournalPlayLogService } from "./journal-play-log.service";
import { PlaytimeModule } from "../playtime/playtime.module";
import { JournalHeatmapService } from "./journal-heatmap.service";
import { ActivitiesRepositoryModule } from "../activities/activities-repository/activities-repository.module";

/**
 * This modules exposed functionality related to the 'journal' feature, which is basically
 * a log of user's activities related to games.
 */
@Module({
    imports: [
        CollectionsEntriesModule,
        GameAchievementModule,
        PlaytimeModule,
        ActivitiesRepositoryModule,
    ],
    providers: [JournalService, JournalPlayLogService, JournalHeatmapService],
    controllers: [JournalController],
})
export class JournalModule {}
