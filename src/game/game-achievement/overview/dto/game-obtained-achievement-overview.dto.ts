import { GameAchievementWithObtainedInfo } from "../../dto/game-obtained-achievement.dto";

export class ObtainedByPlatformOverviewDto {
    platformId: number;
    items: GameAchievementWithObtainedInfo[];
}

export class GameObtainedAchievementOverviewDto {
    /**
     * Total achievements obtained across all connected platforms.
     */
    totalObtained: number;
    obtainedByPlatform: ObtainedByPlatformOverviewDto[];
}
