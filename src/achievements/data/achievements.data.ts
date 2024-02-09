import { Achievement } from "../models/achievement.model";
import { achievementsReviewsData } from "./achievements-reviews.data";
import { achievementsFollowersData } from "./achievements-followers.data";
import { achievementsCollectionsData } from "./achievements-collections.data";
import { achievementsMiscData } from "./achievements-misc.data";

export const achievementsData: Achievement[] = [
    ...achievementsReviewsData,
    ...achievementsFollowersData,
    ...achievementsCollectionsData,
    ...achievementsMiscData,
];
