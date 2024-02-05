import { Achievement } from "../models/achievement.model";
import { AchievementCategory } from "../achievements.constants";

export const achievementsMiscData: Achievement[] = [
    {
        id: "beta-tester",
        name: "Test Lab",
        description: "Become a beta tester of GameNode",
        expGainAmount: 100,
        category: AchievementCategory.MISC,
        checkEligibility: () => false,
    },
    {
        id: "dna",
        name: "DNA",
        description: "Contribute to GameNode's source code",
        expGainAmount: 100,
        category: AchievementCategory.MISC,
        checkEligibility: () => false,
    },
    {
        id: "spaceman",
        name: "Spaceman",
        description: "Donate to GameNode",
        expGainAmount: 150,
        category: AchievementCategory.MISC,
        checkEligibility: () => false,
    },
];
