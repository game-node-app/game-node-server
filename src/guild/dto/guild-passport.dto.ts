import { ApiProperty } from "@nestjs/swagger";
import {
    GuildChestTierKey,
    GuildConsumableKey,
    GuildRank,
    GuildRewardKind,
} from "../guild.constants";
import { GuildChestResultDto } from "./guild-rewards.dto";

export enum GuildPassportMilestoneStatus {
    LOCKED = "locked",
    CLAIMABLE = "claimable",
    CLAIMED = "claimed",
}

export class GuildPassportMilestoneDto {
    @ApiProperty({ example: 2 })
    milestone: number;

    @ApiProperty({ enum: GuildPassportMilestoneStatus })
    status: GuildPassportMilestoneStatus;

    @ApiProperty({
        enum: GuildRewardKind,
        example: GuildRewardKind.CHEST_BRONZE,
    })
    chestKind: GuildChestTierKey;

    @ApiProperty({ example: 25 })
    sealsReward: number;

    @ApiProperty({
        enum: GuildConsumableKey,
        nullable: true,
        example: "hourglass",
    })
    consumableKey: GuildConsumableKey | null;

    @ApiProperty({ example: 1 })
    consumableQuantity: number;
}

export class GuildPassportResponseDto {
    @ApiProperty({ example: "2026-11" })
    monthKey: string;

    @ApiProperty({ example: 3 })
    completedContractsCount: number;

    @ApiProperty({ type: Date, example: "2026-12-01T03:00:00.000Z" })
    resetsAt: Date;

    @ApiProperty({ type: () => GuildPassportMilestoneDto, isArray: true })
    milestones: GuildPassportMilestoneDto[];
}

/** `GET /v1/guild` overview summary; the full stamp track stays on the passport route. */
export class GuildPassportSummaryDto {
    @ApiProperty({ example: "2026-11" })
    monthKey: string;

    @ApiProperty({ example: 3 })
    completedContractsCount: number;

    @ApiProperty({ type: Number, isArray: true, example: [2] })
    claimableMilestones: number[];
}

export class ClaimGuildPassportMilestoneResponseDto {
    @ApiProperty({ example: "2026-11" })
    monthKey: string;

    @ApiProperty({ example: 2 })
    milestone: number;

    @ApiProperty({ type: Number, isArray: true, example: [2, 4] })
    claimedMilestones: number[];

    @ApiProperty({ example: 6 })
    completedContractsCount: number;

    @ApiProperty({ type: () => GuildChestResultDto })
    chestResult: GuildChestResultDto;

    @ApiProperty({
        example: 40,
        description: "Flat milestone Seals plus the chest's Seal payout.",
    })
    sealsAwarded: number;

    @ApiProperty({ enum: GuildConsumableKey, nullable: true })
    consumableKey: GuildConsumableKey | null;

    @ApiProperty({ example: 1 })
    consumableQuantity: number;

    @ApiProperty({ example: 40, description: "Guild XP from the chest." })
    xpAwarded: number;

    @ApiProperty({
        example: 10,
        description: "Global UserLevel XP credited: floor(xpAwarded × 0.25)",
    })
    globalXpAwarded: number;

    @ApiProperty({ enum: GuildRank })
    rankBefore: GuildRank;

    @ApiProperty({ enum: GuildRank })
    rankAfter: GuildRank;
}
