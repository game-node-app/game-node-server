import { GameAchievementDto } from "./dto/game-achievement.dto";
import {
    GameAchievementWithObtainedInfo,
    GameObtainedAchievementDto,
} from "./dto/game-obtained-achievement.dto";
import { ObtainedGameAchievement } from "./entity/obtained-game-achievement.entity";

export const getPSNAchievementId = (
    npCommunicationId: string,
    trophyId: number,
) => `${npCommunicationId}_${trophyId}`;

/**
 * Checks is an string is a valid Xbox productId.
 * @example
 * +------------+
 * |uid         |
 * +------------+
 * |BZLN1W2ML7MG|
 * |BZJH18QJVDVW|
 * |BS8M9DCFB5BJ|
 * +------------+
 * @param productId
 */
export const isValidXboxProductId = (productId: string) => {
    const match = productId.match(/^[A-Z0-9]{12}$/);
    return match != undefined && match.length > 0;
};

type CheckableAchievement = Pick<GameAchievementDto, "externalId">;

export function checkIfGameIsComplete(
    allAchievementsForGame: GameAchievementDto[],
    obtainedAchievementsForGame: CheckableAchievement[],
) {
    if (allAchievementsForGame.length === 0) return false;

    const obtainedExternalIds = new Set(
        obtainedAchievementsForGame.map((a) => a.externalId),
    );

    if (obtainedExternalIds.size === 0) return false;

    return allAchievementsForGame.every((achievement) =>
        obtainedExternalIds.has(achievement.externalId),
    );
}

export function checkIfGameIsPlatinum(
    allAchievementsForGame: GameAchievementDto[],
    obtainedAchievementsForGame: CheckableAchievement[],
) {
    const platinumTrophies = allAchievementsForGame.filter((achievement) => {
        return (
            achievement.psnDetails != undefined &&
            achievement.psnDetails.trophyType === "platinum"
        );
    });

    if (platinumTrophies.length === 0) return false;

    // Check if platinum trophy is obtained
    return obtainedAchievementsForGame.some((obtained) => {
        return platinumTrophies.some(
            (platinum) => platinum.externalId === obtained.externalId,
        );
    });
}

export function toGameAchievementWithObtainedInfo(
    achievement: GameAchievementDto,
    obtainedAchievement: ObtainedGameAchievement,
): GameAchievementWithObtainedInfo {
    return {
        ...achievement,
        isObtained: obtainedAchievement != undefined,
        obtainedAt: obtainedAchievement.obtainedAt,
    };
}
