import { OmitType } from "@nestjs/swagger";
import { ObtainedGameAchievementActivity } from "../entity/obtained-game-achievement-activity.entity";
import { GameAchievementWithObtainedInfo } from "./game-obtained-achievement.dto";

export class GameObtainedAchievementActivityDto extends OmitType(
    ObtainedGameAchievementActivity,
    ["profile", "obtainedGameAchievements"],
) {
    obtainedGameAchievements: GameAchievementWithObtainedInfo[];
}
