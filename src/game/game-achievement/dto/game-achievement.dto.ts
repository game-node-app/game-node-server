import { EGameExternalGameCategory } from "../../game-repository/game-repository.constants";

export class GameAchievementDto {
    name: string;
    description: string | null;
    externalId: string;
    source: EGameExternalGameCategory;
    externalGameId: number;
    gameId: number;
    iconUrl: string;
    iconGrayUrl?: string;
    // Only for steam achievements
    steamDetails: SteamAchievementDetails | null;
}

export class SteamAchievementDetails {
    /**
     * Global percentage of users that own this achievement (essentially represents rarity).
     */
    globalPercentage: number;
}
