import { ApiProperty } from "@nestjs/swagger";
import { AchievementCategory } from "../achievements.constants";
import { PaginationInfo } from "../../utils/pagination/pagination-response.dto";
import { AchievementIconDto } from "./achievement-admin.dto";

export class AchievementTierV2Dto {
    level: number;
    threshold: number;
    expReward: number;
    obtainedCount: number;
    /**
     * Fraction (0-1) of profiles that obtained this tier. May be up to one hour stale.
     */
    rarity: number;
}

export class AchievementEventDto {
    id: string;
    slug: string;
    name: string;
    description: string;
    startsAt: Date;
    endsAt: Date;
}

export class AchievementV2Dto {
    id: string;
    /**
     * Hidden achievements not obtained by the target user have name, description, metric, criteria and icon set to null
     */
    isHidden: boolean;
    name: string | null;
    description: string | null;
    @ApiProperty({ enum: AchievementCategory })
    category: AchievementCategory;
    metric: string | null;
    @ApiProperty({ type: "object", additionalProperties: true, nullable: true })
    criteria: Record<string, any> | null;
    icon: AchievementIconDto | null;
    event: AchievementEventDto | null;
    /**
     * Effective time window (the event's, when the achievement belongs to one)
     */
    startsAt: Date | null;
    endsAt: Date | null;
    tiers: AchievementTierV2Dto[];
}

export class PaginatedAchievementsV2ResponseDto {
    data: AchievementV2Dto[];
    pagination: PaginationInfo;
}

export class AchievementProgressDto {
    achievementId: string;
    value: number;
    /**
     * Highest obtained tier level, 0 when none
     */
    tier: number;
    /**
     * Threshold of the next tier, null when every tier is obtained
     */
    nextThreshold: number | null;
}

export class AchievementEventsResponseDto {
    active: AchievementEventDto[];
    upcoming: AchievementEventDto[];
    past: AchievementEventDto[];
}
