import { IsNotEmpty, IsOptional, IsString } from "class-validator";
import { ObtainedAchievement } from "../entities/obtained-achievement.entity";
import { AchievementDto } from "./achievement.dto";
import { PickType } from "@nestjs/swagger";
import { BaseFindDto } from "../../utils/base-find.dto";
import { ToBoolean } from "../../utils/toBoolean";

export class GetObtainedAchievementRequestDto extends PickType(
    BaseFindDto<ObtainedAchievement>,
    ["orderBy"],
) {
    @IsNotEmpty()
    @IsString()
    targetUserId: string;
    @IsOptional()
    @ToBoolean()
    isFeatured?: boolean;
}

export class ObtainedAchievementDto extends ObtainedAchievement {
    achievement: AchievementDto;
}
