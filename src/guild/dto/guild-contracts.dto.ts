import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
    IsEnum,
    IsIn,
    IsInt,
    IsOptional,
    IsUUID,
    Max,
    Min,
} from "class-validator";
import { PaginationInfo } from "../../utils/pagination/pagination-response.dto";
import {
    GuildCategory,
    GuildContractStatus,
    GuildCriteria,
    GuildObjectiveType,
    GuildRank,
} from "../guild.constants";
import { GuildBoardEventTranslationDto } from "./guild-board.dto";
import {
    GuildChestResultDto,
    GuildRewardDescriptorDto,
} from "./guild-rewards.dto";
import {
    GuildLicenseDto,
    GuildYearGoalDto,
    LinaReceptionDto,
} from "./guild-profile.dto";

export class AcceptGuildContractDto {
    @ApiPropertyOptional({
        description: "Board entry of the current week being accepted",
        example: "3f1c2b9e-6a5d-4c8f-9b7a-1e2d3c4b5a69",
    })
    @IsOptional()
    @IsUUID()
    boardEntryId?: string;

    @ApiPropertyOptional({
        description: "Active published curated event being accepted",
        example: "9d8c7b6a-5f4e-3d2c-1b0a-9f8e7d6c5b4a",
    })
    @IsOptional()
    @IsUUID()
    eventId?: string;

    @ApiPropertyOptional({
        description:
            "Library game bound to the contract; required when the quest requires a target",
        example: 1029,
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    targetGameId?: number;
}

export class GetGuildContractsQueryDto {
    @ApiPropertyOptional({ enum: GuildContractStatus })
    @IsOptional()
    @IsEnum(GuildContractStatus)
    status?: GuildContractStatus;

    @ApiPropertyOptional({
        enum: ["accepted", "completed"],
        description:
            "accepted = active + ready_to_claim (ready first); completed = completed only",
    })
    @IsOptional()
    @IsIn(["accepted", "completed"])
    tab?: "accepted" | "completed";

    @ApiPropertyOptional({ default: 0, minimum: 0 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    offset?: number;

    @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number;
}

export class GuildContractPlaytimeProgressDto {
    @ApiProperty({ example: 64_800 })
    playedSeconds: number;

    @ApiProperty({ type: Number, nullable: true, example: 104_400 })
    estimatedTotalSeconds: number | null;

    @ApiProperty({
        type: Number,
        nullable: true,
        description: "Clamped to 0..99 while the contract is unfinished",
        example: 62,
    })
    estimatedPercent: number | null;
}

export class GuildContractTargetGameDto {
    @ApiProperty({ example: 1029 })
    gameId: number;

    @ApiProperty({ example: "Hollow Knight" })
    name: string;

    @ApiProperty({ type: String, nullable: true, example: "hollow-knight" })
    slug: string | null;

    @ApiProperty({
        type: String,
        nullable: true,
        example:
            "https://images.igdb.com/igdb/image/upload/t_cover_big/co1.jpg",
    })
    coverUrl: string | null;
}

export class GuildContractEventSummaryDto {
    @ApiProperty({ example: "9d8c7b6a-5f4e-3d2c-1b0a-9f8e7d6c5b4a" })
    id: string;

    @ApiProperty({ example: "metroidvania-month" })
    slug: string;

    @ApiProperty({ example: "Metroidvania Month" })
    title: string;

    @ApiProperty({ example: "Finish a Metroidvania this month." })
    description: string;

    @ApiProperty({ type: () => GuildBoardEventTranslationDto, isArray: true })
    translations: GuildBoardEventTranslationDto[];
}

export class GuildContractDto {
    @ApiProperty({ example: "6c5b4a39-2817-4f6e-8d9c-0b1a2c3d4e5f" })
    id: string;

    @ApiProperty({ type: String, nullable: true, example: null })
    boardEntryId: string | null;

    @ApiProperty({ type: String, nullable: true, example: null })
    eventId: string | null;

    @ApiProperty({ enum: GuildCategory })
    category: GuildCategory;

    @ApiProperty({ type: String, nullable: true, example: "forgotten_relic" })
    templateKey: string | null;

    @ApiProperty({ enum: GuildRank })
    rank: GuildRank;

    @ApiProperty({ example: 250 })
    xpReward: number;

    @ApiProperty({ enum: GuildObjectiveType })
    objectiveType: GuildObjectiveType;

    @ApiProperty({ type: Object, example: {} })
    criteria: GuildCriteria;

    @ApiProperty({ type: Number, nullable: true, example: 1029 })
    targetGameId: number | null;

    @ApiProperty({ type: () => GuildContractTargetGameDto, nullable: true })
    targetGame: GuildContractTargetGameDto | null;

    @ApiProperty({ example: 0 })
    progressCurrent: number;

    @ApiProperty({ example: 1 })
    progressTarget: number;

    @ApiProperty({ enum: GuildContractStatus })
    status: GuildContractStatus;

    @ApiProperty({
        type: () => GuildContractPlaytimeProgressDto,
        nullable: true,
    })
    playtimeProgress: GuildContractPlaytimeProgressDto | null;

    @ApiProperty({ type: () => GuildRewardDescriptorDto, nullable: true })
    reward: GuildRewardDescriptorDto | null;

    @ApiProperty({ type: () => GuildContractEventSummaryDto, nullable: true })
    event: GuildContractEventSummaryDto | null;

    @ApiProperty({ type: Object, nullable: true, example: null })
    claimPayload: Record<string, any> | null;

    @ApiProperty({ example: "2026-06-17T12:00:00.000Z" })
    acceptedAt: Date;

    @ApiProperty({ type: Date, nullable: true, example: null })
    readyAt: Date | null;

    @ApiProperty({ type: Date, nullable: true, example: null })
    claimedAt: Date | null;

    @ApiProperty({ type: Date, nullable: true, example: null })
    expiresAt: Date | null;

    @ApiProperty({ example: "2026-06-17T12:00:00.000Z" })
    createdAt: Date;

    @ApiProperty({ example: "2026-06-17T12:00:00.000Z" })
    updatedAt: Date;
}

export class GuildContractsListResponseDto {
    @ApiProperty({ type: () => GuildContractDto, isArray: true })
    data: GuildContractDto[];

    @ApiProperty({ type: () => PaginationInfo })
    pagination: PaginationInfo;
}

export class AcceptGuildContractResponseDto {
    @ApiProperty({ type: () => GuildContractDto })
    contract: GuildContractDto;

    @ApiProperty({ type: () => LinaReceptionDto })
    lina: LinaReceptionDto;
}

export class ClaimGuildContractResponseDto {
    @ApiProperty({ type: () => GuildContractDto })
    contract: GuildContractDto;

    @ApiProperty({ example: 300 })
    xpAwarded: number;

    @ApiProperty({ enum: GuildRank })
    rankBefore: GuildRank;

    @ApiProperty({ enum: GuildRank })
    rankAfter: GuildRank;

    @ApiProperty({ type: () => GuildRewardDescriptorDto, isArray: true })
    unlockedRewards: GuildRewardDescriptorDto[];

    @ApiProperty({ type: () => GuildChestResultDto, nullable: true })
    chestResult: GuildChestResultDto | null;

    @ApiProperty({ type: () => LinaReceptionDto })
    lina: LinaReceptionDto;
}

export class GuildOverviewCountsDto {
    @ApiProperty({ example: 3 })
    boardCount: number;

    @ApiProperty({ example: 2 })
    acceptedCount: number;

    @ApiProperty({ example: 12 })
    completedCount: number;
}

export class GuildOverviewResponseDto {
    @ApiProperty({ type: () => GuildLicenseDto })
    license: GuildLicenseDto;

    @ApiProperty({ type: () => GuildContractDto, isArray: true })
    activeContracts: GuildContractDto[];

    @ApiProperty({ type: () => GuildYearGoalDto, nullable: true })
    yearGoal: GuildYearGoalDto | null;

    @ApiProperty({ type: () => GuildOverviewCountsDto })
    counts: GuildOverviewCountsDto;

    @ApiProperty({
        description: "Monday of the board week in America/Sao_Paulo",
        example: "2026-06-15",
    })
    weekStart: string;

    @ApiProperty({
        type: Date,
        description: "Next Monday 00:00 America/Sao_Paulo, in UTC",
        example: "2026-06-22T03:00:00.000Z",
    })
    nextRefreshAt: Date;

    @ApiProperty({ type: () => LinaReceptionDto })
    lina: LinaReceptionDto;
}
