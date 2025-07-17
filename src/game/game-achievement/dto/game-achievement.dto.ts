import { EGameExternalGameCategory } from "../../game-repository/game-repository.constants";

/**
 * All game achievements, grouped by source. <br>
 * Only available in v2 for gameId query. <br>
 */
export class GameAchievementGroupDto {
    source: EGameExternalGameCategory;
    sourceName: string;
    sourceAbbreviatedName: string;
    iconName: string;
    achievements: GameAchievementDto[];
}

export class GameAchievementDto {
    name: string;
    description: string | null;
    externalId: string;
    source: EGameExternalGameCategory;
    externalGameId: number;
    gameId: number;
    iconUrl: string;
    /**
     * Related GamePlatform references.
     * Usually, an achievement is only related to one platform.
     */
    platformIds: number[];
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
}

export class XboxAchievementDetails {
    /**
     * Gamerscore granted by this achievement.
     */
    gamerScore: number;
}
