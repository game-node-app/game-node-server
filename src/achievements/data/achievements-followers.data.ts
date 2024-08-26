import { Achievement } from "../models/achievement.model";
import { AchievementCategory } from "../achievements.constants";
import { UserFollow } from "../../follow/entity/user-follow.entity";

export const achievementsFollowersData: Achievement[] = [
    {
        id: "take-off",
        name: "Take Off",
        description: "Have 10 (ten) followers",
        category: AchievementCategory.FOLLOWERS,
        expGainAmount: 50,
        checkEligibility: async (dataSource, targetUserId) => {
            const userFollowRepository = dataSource.getRepository(UserFollow);
            const totalFollowers = await userFollowRepository.countBy({
                followedUserId: targetUserId,
            });

            return totalFollowers >= 10;
        },
    },
    {
        id: "crew",
        name: "Crew",
        description: "Have 50 (fifty) followers",
        category: AchievementCategory.FOLLOWERS,
        expGainAmount: 150,
        checkEligibility: async (dataSource, targetUserId) => {
            const userFollowRepository = dataSource.getRepository(UserFollow);
            const totalFollowers = await userFollowRepository.countBy({
                followedUserId: targetUserId,
            });

            return totalFollowers >= 50;
        },
    },
    {
        id: "you-are-fireworks",
        name: "Baby, you're fireworks!",
        description: "Have 100 (a hundred) followers",
        category: AchievementCategory.FOLLOWERS,
        expGainAmount: 300,
        checkEligibility: async (dataSource, targetUserId) => {
            const userFollowRepository = dataSource.getRepository(UserFollow);
            const totalFollowers = await userFollowRepository.countBy({
                followedUserId: targetUserId,
            });

            return totalFollowers >= 100;
        },
    },
];
