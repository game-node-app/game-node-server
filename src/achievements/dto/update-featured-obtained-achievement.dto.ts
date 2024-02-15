import { PickType } from "@nestjs/swagger";
import { ObtainedAchievement } from "../entities/obtained-achievement.entity";

export class UpdateFeaturedObtainedAchievementDto extends PickType(
    ObtainedAchievement,
    ["id", "isFeatured"],
) {}
