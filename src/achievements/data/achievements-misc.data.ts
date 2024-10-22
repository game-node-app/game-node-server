import { Achievement } from "../models/achievement.model";
import { AchievementCategory } from "../achievements.constants";

export const achievementsMiscData: Achievement[] = [
    {
        id: "test-lab",
        name: "Test Lab",
        description: "Become a beta tester of GameNode",
        expGainAmount: 100,
        category: AchievementCategory.MISC,
        checkEligibility: async () => false,
    },
    {
        id: "dna",
        name: "DNA",
        description: "Contribute to GameNode's source code",
        expGainAmount: 100,
        category: AchievementCategory.MISC,
        checkEligibility: async () => false,
    },
    {
        id: "spaceman",
        name: "Spaceman",
        description: "Donate to GameNode",
        expGainAmount: 150,
        category: AchievementCategory.MISC,
        checkEligibility: async () => false,
    },
    {
        id: "area-42",
        name: "Does this mean something?",
        description: "Be a member of Area 42",
        expGainAmount: 100,
        category: AchievementCategory.MISC,
        checkEligibility: async () => false,
    },
];
