import { Achievement } from "../models/achievement.model";
import {
    AchievementCategory,
    ACHIEVEMENTS_GAME_THEMES_IDS,
} from "../achievements.constants";
import { Review } from "../../reviews/entities/review.entity";

export const achievementsReviewsData: Achievement[] = [
    {
        id: "spooky",
        name: "Spooky",
        description: "Review an horror game",
        expGainAmount: 50,
        category: AchievementCategory.REVIEWS,
        checkEligibility: async (dataSource, targetUserId) => {
            const reviewsRepository = dataSource.getRepository(Review);
            return await reviewsRepository.exists({
                where: {
                    profile: {
                        userId: targetUserId,
                    },
                    game: {
                        themes: {
                            // Horror game ID in the game_theme table.
                            id: ACHIEVEMENTS_GAME_THEMES_IDS.HORROR_ID,
                        },
                    },
                },
            });
        },
    },
];
