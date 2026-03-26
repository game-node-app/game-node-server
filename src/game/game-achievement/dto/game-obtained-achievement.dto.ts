import { GameAchievementDto } from "./game-achievement.dto";
import { IntersectionType, OmitType, PickType } from "@nestjs/swagger";
import { BaseFindDto } from "../../../utils/base-find.dto";
import { ObtainedGameAchievement } from "../entity/obtained-game-achievement.entity";
import {
    PaginationInfo,
    PaginationResponseDto,
} from "../../../utils/pagination/pagination-response.dto";

export class FindObtainedGameAchievementsRequestDto extends OmitType(
    BaseFindDto<ObtainedGameAchievement>,
    ["search"],
) {}

export class FindObtainedAchievementsResponseDto
    implements PaginationResponseDto
{
    data: GameObtainedAchievementDto[];
    pagination: PaginationInfo;
}

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
