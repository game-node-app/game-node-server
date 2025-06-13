import { IsNotEmpty, IsString } from "class-validator";
import { ObtainedAchievement } from "../entities/obtained-achievement.entity";
import { AchievementDto } from "./achievement.dto";

export class GetObtainedAchievementRequestDto {
    @IsNotEmpty()
    @IsString()
    targetUserId: string;
}

export class ObtainedAchievementDto extends ObtainedAchievement {
    achievement: AchievementDto;
}
