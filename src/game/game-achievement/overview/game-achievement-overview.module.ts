import { Module } from "@nestjs/common";
import { GameAchievementOverviewService } from "./game-achievement-overview.service";
import { GameAchievementOverviewController } from "./game-achievement-overview.controller";
import { SteamSyncModule } from "../../../sync/steam/steam-sync.module";

@Module({
    imports: [SteamSyncModule],
    providers: [GameAchievementOverviewService],
    controllers: [GameAchievementOverviewController],
})
export class GameAchievementOverviewModule {}
