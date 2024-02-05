import { AchievementCategory } from "../achievements.constants";
import { DataSource } from "typeorm";
import { Exclude } from "class-transformer";

export class Achievement {
    id: string;
    name: string;
    description: string;
    expGainAmount: number;
    category: AchievementCategory;
    /**
     * Checks if a given user is eligible to get 'this' achievement
     */
    @Exclude()
    checkEligibility: (
        dataSource: DataSource,
        targetUserId: string,
    ) => Promise<boolean>;
}
