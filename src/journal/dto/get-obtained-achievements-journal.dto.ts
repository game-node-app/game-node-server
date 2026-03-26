import { OmitType } from "@nestjs/swagger";
import { BaseFindDto } from "../../utils/base-find.dto";
import { GameAchievementWithObtainedInfo } from "../../game/game-achievement/dto/game-obtained-achievement.dto";

export class GetObtainedAchievementsJournalRequestDto extends OmitType(
    BaseFindDto,
    ["search"],
) {}

export class GetObtainedAchievementsJournalResponseDto {
    years: JournalAchievementsYearGroup[];
}

export class JournalAchievementsGameGroup {
    gameId: number;
    /**
     * If all achievements for this game are obtained, this will be true.
     */
    isComplete: boolean;
    /**
     * Exclusive to PSN.
     * If the platinum trophy for this game is obtained, this will be true.
     * Not all games have a platinum trophy, and if a Platinum is obtained before a new achievement is added to the game,
     * there may be cases where the game is 'platinum' but not 'completed'.
     */
    isPlatinum: boolean;
    achievements: GameAchievementWithObtainedInfo[];
}

export class JournalAchievementsMonthGroup {
    /**
     * Month of year, 0 indexed (0 = January, 11 = December)
     */
    month: number;
    games: JournalAchievementsGameGroup[];
}

export class JournalAchievementsYearGroup {
    /**
     * Year of achievement obtainment, e.g. 2025
     */
    year: number;
    totalObtained: number;
    months: JournalAchievementsMonthGroup[];
}
