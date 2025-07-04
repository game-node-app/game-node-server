import { EGameExternalGameCategory } from "../../game-repository/game-repository.constants";

export class GameAchievementDto {
    name: string;
    description: string | null;
    externalId: string;
    source: EGameExternalGameCategory;
    externalGameId: number;
    gameId: number;
    iconUrl: string;
    // Only for steam achievements
    steamDetails?: SteamAchievementDetails | null;
    // Only for psn achievements
    psnDetails?: PsnAchievementDetails | null;
    // Only for xbox achievements
    xboxDetails?: XboxAchievementDetails | null;
}

export class SteamAchievementDetails {
    /**
     * Global percentage of users that own this achievement (essentially represents rarity).
     */
    globalPercentage: number;
}

export class PsnAchievementDetails {
    trophyType: string;
    trophyIcon: string;
    /**
     * @example "default", "001", "002"
     */
    trophyGroupId: string;
    /**
     * @example 167 - ps5
     */
    platformId: number;
}

export class XboxAchievementDetails {
    /**
     * Gamerscore granted by this achievement.
     */
    gamerScore: number;
}
