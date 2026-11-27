import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional } from "class-validator";
import {
    GuildChainKey,
    GuildChainStatus,
    GuildCriteria,
    GuildObjectiveType,
    GuildRank,
} from "../guild.constants";
import { GuildRewardDescriptorDto } from "./guild-rewards.dto";

/** Listing state: `locked` and `available` exist only before the first stage. */
export enum GuildChainListStatus {
    LOCKED = "locked",
    AVAILABLE = "available",
    IN_PROGRESS = "in_progress",
    COMPLETED = "completed",
}

export class StartGuildChainDto {
    @ApiPropertyOptional({
        description:
            "Library game bound to every stage of the chain; required when Stage 1 needs one",
        example: 1029,
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    targetGameId?: number;
}

export class AdvanceGuildChainDto extends StartGuildChainDto {}

export class GuildChainStageDto {
    @ApiProperty({ example: 0 })
    index: number;

    @ApiProperty({ example: "trail_head" })
    stageKey: string;

    @ApiProperty({ enum: GuildObjectiveType })
    objectiveType: GuildObjectiveType;

    @ApiProperty({ example: 120 })
    targetCount: number;

    @ApiProperty({ type: Object, example: {} })
    criteria: GuildCriteria;

    @ApiProperty({ example: 100 })
    xpReward: number;

    @ApiProperty({ example: 15 })
    sealsReward: number;

    @ApiProperty({ example: 21 })
    durationDays: number;

    @ApiProperty({ example: true })
    usesBoundTargetGame: boolean;
}

export class GuildChainBoundGameDto {
    @ApiProperty({ example: 1029 })
    gameId: number;

    @ApiProperty({ example: "Celeste" })
    name: string;

    @ApiProperty({ type: String, nullable: true, example: "celeste" })
    slug: string | null;

    @ApiProperty({
        type: String,
        nullable: true,
        example:
            "https://images.igdb.com/igdb/image/upload/t_cover_big/co1.jpg",
    })
    coverUrl: string | null;
}

export class GuildChainDto {
    @ApiProperty({ example: "pathfinders_arc" })
    chainKey: GuildChainKey;

    @ApiProperty({ example: "guild_chain_pathfinders_arc_title" })
    titleKey: string;

    @ApiProperty({ enum: GuildRank })
    minRank: GuildRank;

    @ApiProperty({ enum: GuildChainListStatus })
    status: GuildChainListStatus;

    @ApiProperty({ example: 0 })
    currentStageIndex: number;

    @ApiProperty({ example: 3 })
    totalStages: number;

    @ApiProperty({ type: Number, nullable: true, example: 1029 })
    boundTargetGameId: number | null;

    @ApiProperty({ type: () => GuildChainBoundGameDto, nullable: true })
    boundGame: GuildChainBoundGameDto | null;

    @ApiProperty({ type: String, nullable: true, example: null })
    activeContractId: string | null;

    @ApiProperty({ type: () => GuildChainStageDto, isArray: true })
    stages: GuildChainStageDto[];

    @ApiProperty({ type: () => GuildRewardDescriptorDto, isArray: true })
    finalRewards: GuildRewardDescriptorDto[];

    @ApiProperty({ example: 100 })
    finalBonusSeals: number;
}

export class GuildChainsResponseDto {
    @ApiProperty({ type: () => GuildChainDto, isArray: true })
    chains: GuildChainDto[];
}

export class GuildChainActionResponseDto {
    @ApiProperty({ type: () => GuildChainDto })
    chain: GuildChainDto;

    @ApiProperty({ example: "6c5b4a39-2817-4f6e-8d9c-0b1a2c3d4e5f" })
    contractId: string;
}

/** Claim-time stage progression, embedded in the contract claim receipt. */
export class GuildChainClaimProgressDto {
    @ApiProperty({ example: "pathfinders_arc" })
    chainKey: GuildChainKey;

    @ApiProperty({ example: 1 })
    currentStageIndex: number;

    @ApiProperty({ enum: GuildChainStatus })
    status: GuildChainStatus;

    @ApiProperty({ example: false })
    chainCompleted: boolean;

    @ApiProperty({ type: () => GuildRewardDescriptorDto, isArray: true })
    finalRewards: GuildRewardDescriptorDto[];

    @ApiProperty({ example: 0 })
    bonusSealsAwarded: number;
}

/** Lightweight `GET /v1/guild` overview summary. */
export class GuildActiveChainSummaryDto {
    @ApiProperty({ example: "pathfinders_arc" })
    chainKey: GuildChainKey;

    @ApiProperty({ enum: GuildChainStatus })
    status: GuildChainStatus;

    @ApiProperty({ example: 1 })
    currentStageIndex: number;

    @ApiProperty({ example: 3 })
    totalStages: number;

    @ApiProperty({ type: Number, nullable: true, example: 1029 })
    boundTargetGameId: number | null;

    @ApiProperty({ type: String, nullable: true, example: null })
    activeContractId: string | null;
}
