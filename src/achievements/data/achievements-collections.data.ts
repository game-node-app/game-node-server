import { Achievement } from "../models/achievement.model";
import { AchievementCategory } from "../achievements.constants";
import { Review } from "../../reviews/entities/review.entity";

export const achievementsCollectionsData: Achievement[] = [
    {
        id: "spooky",
        name: "Spooky",
        description: "Review an horror game",
        expGainAmount: 50,
        category: AchievementCategory.COLLECTIONS,
        checkEligibility: async (dataSource, targetUserId) => {
            // Horror game ID in the game_theme table.
            const horrorGameThemeId = 19;
            const reviewsRepository = dataSource.getRepository(Review);
            return await reviewsRepository.exist({
                where: {
                    profile: {
                        userId: targetUserId,
                    },
                    game: {
                        themes: {
                            id: horrorGameThemeId,
                        },
                    },
                },
            });
        },
    },
    {
        id: "space-station",
        name: "Space Station",
        description: "Add 100 games to your collections",
        expGainAmount: 75,
        category: AchievementCategory.COLLECTIONS,
        checkEligibility: async (dataSource, targetUserId) => {
            // Horror game ID in the game_theme table.
            const horrorGameThemeId = 19;
            const reviewsRepository = dataSource.getRepository(Review);
            return await reviewsRepository.exist({
                where: {
                    profile: {
                        userId: targetUserId,
                    },
                    game: {
                        themes: {
                            id: horrorGameThemeId,
                        },
                    },
                },
            });
        },
    },
];
