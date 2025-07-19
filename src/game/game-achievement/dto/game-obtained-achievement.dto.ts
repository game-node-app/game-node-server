import { GameAchievementDto } from "./game-achievement.dto";
import { IntersectionType, PickType } from "@nestjs/swagger";

export class GameObtainedAchievementDto extends PickType(GameAchievementDto, [
    "externalGameId",
    "externalId",
    "gameId",
    "source",
]) {
    isObtained: boolean;
    obtainedAt: Date | null;
}

export class GameAchievementWithObtainedInfo extends IntersectionType(
    GameAchievementDto,
    GameObtainedAchievementDto,
) {}
