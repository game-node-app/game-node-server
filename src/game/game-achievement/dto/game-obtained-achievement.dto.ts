import { GameAchievementDto } from "./game-achievement.dto";
import { PickType } from "@nestjs/swagger";

export class GameObtainedAchievementDto extends PickType(GameAchievementDto, [
    "externalGameId",
    "externalId",
    "gameId",
    "source",
]) {
    isObtained: boolean;
    obtainedAt: Date | null;
}
