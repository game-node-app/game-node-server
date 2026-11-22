import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
    IsArray,
    IsBoolean,
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
    GuildCriteria,
    GuildEventStatus,
    GuildLocale,
    GuildObjectiveType,
    GuildRank,
    GuildRewardKind,
} from "../guild.constants";
import { GuildRewardDescriptorDto } from "./guild-rewards.dto";

const LOCALES = Object.values(GuildLocale);

export class GuildEventTranslationDto {
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

export class CreateGuildEventDto {
    @ApiProperty({ example: "metroidvania-month-2026" })
    @IsString()
    @Length(1, 64)
    slug: string;

    @ApiProperty({ example: "Metroidvania Month" })
    @IsString()
    @Length(1, 120)
    title: string;

    @ApiProperty({ example: "Finish a metroidvania this month." })
    @IsString()
    @Length(1, 500)
    description: string;

    @ApiProperty({ enum: GuildRank })
    @IsEnum(GuildRank)
    rank: GuildRank;

    @ApiProperty({ example: 400 })
    @IsInt()
    @Min(1)
    xpReward: number;

    @ApiProperty({ enum: GuildObjectiveType })
    @IsEnum(GuildObjectiveType)
    objectiveType: GuildObjectiveType;

    @ApiPropertyOptional({ default: 1, minimum: 1 })
    @IsOptional()
    @IsInt()
    @Min(1)
    targetCount?: number;

    @ApiPropertyOptional({
        type: Object,
        description: "Objective filters; see validateGuildQuestRules.",
    })
    @IsOptional()
    @IsObject()
    criteria?: GuildCriteria;

    @ApiPropertyOptional({
        type: String,
        nullable: true,
        example: "ae5accd3-8e22-4aff-aa92-290b32e06cb4",
    })
    @IsOptional()
    @IsUUID()
    rewardId?: string;

    @ApiProperty({ type: Date })
    @Type(() => Date)
    @IsDate()
    startsAt: Date;

    @ApiProperty({ type: Date })
    @Type(() => Date)
    @IsDate()
    endsAt: Date;

    @ApiPropertyOptional({
        type: () => GuildEventTranslationDto,
        isArray: true,
        description: "Omitted preserves stored translations; [] clears them.",
    })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => GuildEventTranslationDto)
    translations?: GuildEventTranslationDto[];
}

export class UpdateGuildEventDto extends PartialType(CreateGuildEventDto) {}

export class GuildAdminEventResponseDto {
    @ApiProperty() id: string;
    @ApiProperty() slug: string;
    @ApiProperty() title: string;
    @ApiProperty() description: string;
    @ApiProperty({ enum: GuildRank }) rank: GuildRank;
    @ApiProperty() xpReward: number;
    @ApiProperty({ enum: GuildObjectiveType })
    objectiveType: GuildObjectiveType;
    @ApiProperty() targetCount: number;
    @ApiProperty({ type: Object }) criteria: GuildCriteria;

    @ApiProperty({ type: () => GuildRewardDescriptorDto, nullable: true })
    reward: GuildRewardDescriptorDto | null;

    @ApiProperty({ type: Date }) startsAt: Date;
    @ApiProperty({ type: Date }) endsAt: Date;
    @ApiProperty({ enum: GuildEventStatus }) status: GuildEventStatus;
    @ApiProperty({ type: Date, nullable: true }) publishedAt: Date | null;

    @ApiProperty({ type: () => GuildEventTranslationDto, isArray: true })
    translations: GuildEventTranslationDto[];

    @ApiProperty({ type: Date }) createdAt: Date;
    @ApiProperty({ type: Date }) updatedAt: Date;
}

export class CreateGuildRewardDto {
    @ApiProperty({ example: "frame_metroidvania_2026" })
    @IsString()
    @Length(1, 64)
    key: string;

    @ApiProperty({ enum: GuildRewardKind })
    @IsEnum(GuildRewardKind)
    kind: GuildRewardKind;

    @ApiPropertyOptional({
        type: String,
        nullable: true,
        description:
            "Required for badge rewards; must be an existing definition.",
    })
    @IsOptional()
    @IsString()
    @Length(1, 36)
    achievementId?: string;

    @ApiPropertyOptional({ default: false })
    @IsOptional()
    @IsBoolean()
    inChestPool?: boolean;

    @ApiPropertyOptional({ default: 0, minimum: 0 })
    @IsOptional()
    @IsInt()
    @Min(0)
    chestBonusXp?: number;

    @ApiPropertyOptional({ default: true })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

export class UpdateGuildRewardDto extends PartialType(CreateGuildRewardDto) {}

export class GuildAdminRewardResponseDto {
    @ApiProperty({ example: "ae5accd3-8e22-4aff-aa92-290b32e06cb4" })
    id: string;

    @ApiProperty({ example: "title_chronist" })
    key: string;

    @ApiProperty({ enum: GuildRewardKind })
    kind: GuildRewardKind;

    @ApiProperty({ type: String, nullable: true })
    achievementId: string | null;

    @ApiProperty() inChestPool: boolean;
    @ApiProperty() chestBonusXp: number;
    @ApiProperty() isActive: boolean;
    @ApiProperty({ type: Date }) createdAt: Date;
    @ApiProperty({ type: Date }) updatedAt: Date;
}
