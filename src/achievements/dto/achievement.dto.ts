import { AchievementCategory } from "../achievements.constants";

export class AchievementDto {
    id: string;
    name: string;
    description: string;
    expGainAmount: number;
    category: AchievementCategory;
}
