import { BaseFindDto } from "../../utils/base-find.dto";
import { AchievementDefinition } from "../entities/achievement-definition.entity";
import { PickType } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";
import { ClampLimit, MAX_LARGE_PAGE_LIMIT } from "../../utils/request-bounds";

export class GetAchievementsRequestDto extends PickType(
    BaseFindDto<AchievementDefinition>,
    ["offset", "limit"],
) {
    // The release calendar, collection move form and admin achievement list load a whole set at once.
    @ClampLimit(MAX_LARGE_PAGE_LIMIT)
    limit?: number = 20;
}

export class GetAchievementsV2RequestDto extends GetAchievementsRequestDto {
    /**
     * Reveals hidden achievements this user has obtained
     */
    @IsOptional()
    @IsString()
    targetUserId?: string;
}
