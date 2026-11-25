import {
    ApiExtraModels,
    ApiProperty,
    ApiPropertyOptional,
    PartialType,
    getSchemaPath,
} from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsDate,
    IsEnum,
    IsIn,
    IsInt,
    IsObject,
    IsOptional,
    IsString,
    IsUUID,
    Length,
    Min,
    ValidateNested,
} from "class-validator";
import {
    GuildBountyStatus,
    GuildChestTierKey,
    GuildCriteria,
    GuildLocale,
    GuildObjectiveType,
    GuildRank,
    GuildRewardKind,
} from "../guild.constants";
import {
    GuildChestResultDto,
    GuildRewardDescriptorDto,
} from "./guild-rewards.dto";

const LOCALES = Object.values(GuildLocale);
const CHEST_KINDS = [
    GuildRewardKind.CHEST_BRONZE,
    GuildRewardKind.CHEST_SILVER,
    GuildRewardKind.CHEST_GOLD,
    GuildRewardKind.CHEST_RELIC,
] as const;

export class GuildBountyTranslationDto {
    @ApiProperty({ enum: GuildLocale })
    @IsIn(LOCALES)
    locale: GuildLocale;

    @ApiProperty()
    @IsString()
    @Length(1, 120)
    title: string;

    @ApiProperty()
    @IsString()
    @Length(1, 500)
    description: string;
}

/** One milestone's flat and/or catalog reward; empty objects are valid. */
export class GuildBountyMilestoneRewardDto {
    @ApiPropertyOptional({ minimum: 0, example: 25 })
    @IsOptional()
    @IsInt()
    @Min(0)
    seals?: number;

    @ApiPropertyOptional({ minimum: 0, example: 100 })
    @IsOptional()
    @IsInt()
    @Min(0)
    xp?: number;

    @ApiPropertyOptional({ type: String, format: "uuid" })
    @IsOptional()
    @IsUUID()
    rewardId?: string;

    @ApiPropertyOptional({ enum: CHEST_KINDS })
    @IsOptional()
    @IsIn(CHEST_KINDS)
    chestKind?: GuildChestTierKey;
}

@ApiExtraModels(GuildBountyMilestoneRewardDto)
export class CreateGuildBountyDto {
    @ApiProperty({ example: "spooky-october-2026" })
    @IsString()
    @Length(1, 64)
    slug: string;

    @ApiProperty({ example: "Spooky October" })
    @IsString()
    @Length(1, 120)
    title: string;

    @ApiProperty({ example: "Finish a horror game this month." })
    @IsString()
    @Length(1, 500)
    description: string;

    @ApiProperty({ enum: GuildObjectiveType })
    @IsIn(Object.values(GuildObjectiveType))
    objectiveType: GuildObjectiveType;

    @ApiPropertyOptional({
        type: Object,
        description: "Objective filters; see validateGuildQuestRules.",
    })
    @IsOptional()
    @IsObject()
    criteria?: GuildCriteria;

    @ApiProperty({ example: 500, minimum: 1 })
    @IsInt()
    @Min(1)
    targetTotal: number;

    @ApiPropertyOptional({ default: 1, minimum: 1 })
    @IsOptional()
    @IsInt()
    @Min(1)
    minUserContribution?: number;

    @ApiProperty({ example: 10, minimum: 1 })
    @IsInt()
    @Min(1)
    maxUserContributionCap: number;

    @ApiPropertyOptional({
        type: Object,
        additionalProperties: {
            $ref: getSchemaPath(GuildBountyMilestoneRewardDto),
        },
        description:
            'Milestone rewards keyed by "25", "50", "100" and "150"; missing keys default to {}.',
    })
    @IsOptional()
    @IsObject()
    milestoneRewards?: Partial<Record<string, GuildBountyMilestoneRewardDto>>;

    @ApiProperty({ type: Date })
    @Type(() => Date)
    @IsDate()
    startsAt: Date;

    @ApiProperty({ type: Date })
    @Type(() => Date)
    @IsDate()
    endsAt: Date;

    @ApiProperty({
        type: () => GuildBountyTranslationDto,
        isArray: true,
        description: "Both `en` and `pt-BR` translations are required.",
    })
    @IsArray()
    @ArrayMinSize(2)
    @ArrayMaxSize(2)
    @ValidateNested({ each: true })
    @Type(() => GuildBountyTranslationDto)
    translations: GuildBountyTranslationDto[];
}

export class UpdateGuildBountyDto extends PartialType(CreateGuildBountyDto) {}

export class GuildAdminBountyResponseDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    slug: string;

    @ApiProperty()
    title: string;

    @ApiProperty()
    description: string;

    @ApiProperty({ enum: GuildObjectiveType })
    objectiveType: GuildObjectiveType;

    @ApiProperty({ type: Object })
    criteria: GuildCriteria;

    @ApiProperty()
    targetTotal: number;

    @ApiProperty()
    currentTotal: number;

    @ApiProperty()
    minUserContribution: number;

    @ApiProperty()
    maxUserContributionCap: number;

    @ApiProperty({ type: Object })
    milestoneRewards: Record<string, GuildBountyMilestoneRewardDto>;

    @ApiProperty({ type: Date })
    startsAt: Date;

    @ApiProperty({ type: Date })
    endsAt: Date;

    @ApiProperty({ enum: GuildBountyStatus })
    status: GuildBountyStatus;

    @ApiProperty({ type: Date, nullable: true })
    publishedAt: Date | null;

    @ApiProperty({ type: Date, nullable: true })
    reached100At: Date | null;

    @ApiProperty({ type: () => GuildBountyTranslationDto, isArray: true })
    translations: GuildBountyTranslationDto[];

    @ApiProperty({ type: Date })
    createdAt: Date;

    @ApiProperty({ type: Date })
    updatedAt: Date;
}

export class GuildBountyMilestoneStateDto {
    @ApiProperty({ example: 25 })
    milestone: number;

    @ApiProperty()
    unlocked: boolean;

    @ApiProperty()
    claimed: boolean;

    @ApiProperty()
    claimable: boolean;

    @ApiProperty()
    sealsReward: number;

    @ApiProperty()
    xpReward: number;

    @ApiProperty({ type: String, nullable: true })
    rewardId: string | null;

    @ApiProperty({ enum: CHEST_KINDS, nullable: true })
    chestKind: GuildChestTierKey | null;
}

export class GuildBountyDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    slug: string;

    @ApiProperty()
    title: string;

    @ApiProperty()
    description: string;

    @ApiProperty({ enum: GuildObjectiveType })
    objectiveType: GuildObjectiveType;

    @ApiProperty()
    targetTotal: number;

    @ApiProperty()
    currentTotal: number;

    @ApiProperty({ example: 42 })
    progressPercent: number;

    @ApiProperty({ type: Date })
    startsAt: Date;

    @ApiProperty({ type: Date })
    endsAt: Date;

    @ApiProperty({ enum: GuildBountyStatus })
    status: GuildBountyStatus;

    @ApiProperty()
    userContribution: number;

    @ApiProperty()
    minUserContribution: number;

    @ApiProperty()
    eligible: boolean;

    @ApiProperty({ type: Number, isArray: true, example: [25, 50] })
    claimedMilestones: number[];

    @ApiProperty({ type: () => GuildBountyMilestoneStateDto, isArray: true })
    milestones: GuildBountyMilestoneStateDto[];

    @ApiProperty()
    hasClaimableMilestones: boolean;
}

export class GuildBountiesResponseDto {
    @ApiProperty({ type: () => GuildBountyDto, isArray: true })
    bounties: GuildBountyDto[];
}

export class GetGuildBountiesQueryDto {
    @ApiPropertyOptional({
        enum: GuildLocale,
        description: "Preferred bounty translation; defaults to the base copy",
        example: GuildLocale.PT_BR,
    })
    @IsOptional()
    @IsEnum(GuildLocale)
    locale?: GuildLocale;
}

export class GuildBountiesSummaryDto {
    @ApiProperty()
    activeBountiesCount: number;

    @ApiProperty()
    claimableBountiesCount: number;
}

export class ClaimGuildBountyResponseDto {
    @ApiProperty()
    bountyId: string;

    @ApiProperty({ type: Number, isArray: true, example: [25, 50, 100] })
    claimedMilestones: number[];

    @ApiProperty({ type: Number, isArray: true, example: [25, 50, 100] })
    newlyClaimedMilestones: number[];

    @ApiProperty({
        description: "Flat milestone Seals plus chest Seal payouts.",
    })
    sealsAwarded: number;

    @ApiProperty()
    xpAwarded: number;

    @ApiProperty({ description: "floor(xpAwarded × 0.25)" })
    globalXpAwarded: number;

    @ApiProperty({ enum: GuildRank })
    rankBefore: GuildRank;

    @ApiProperty({ enum: GuildRank })
    rankAfter: GuildRank;

    @ApiProperty({ type: () => GuildRewardDescriptorDto, isArray: true })
    unlockedRewards: GuildRewardDescriptorDto[];

    @ApiProperty({ type: () => GuildChestResultDto, isArray: true })
    chestResults: GuildChestResultDto[];
}
