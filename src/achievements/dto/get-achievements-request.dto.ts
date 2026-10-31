import { BaseFindDto } from "../../utils/base-find.dto";
import { AchievementDefinition } from "../entities/achievement-definition.entity";
import { PickType } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";

export class GetAchievementsRequestDto extends PickType(
    BaseFindDto<AchievementDefinition>,
    ["offset", "limit"],
) {}

export class GetAchievementsV2RequestDto extends GetAchievementsRequestDto {
    /**
     * Reveals hidden achievements this user has obtained
     */
    @IsOptional()
    @IsString()
    targetUserId?: string;
}
